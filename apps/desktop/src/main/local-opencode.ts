import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import { Service as OpenCodeService } from "@opencode-ai/client/service";
import type { Endpoint as OpenCodeEndpoint } from "@opencode-ai/client/service";
import { Effect, Schema } from "effect";

import { OPENCODE_VERSION } from "../shared/desktop-api.ts";

export const LOCAL_OPENCODE_VERSION = OPENCODE_VERSION;
const LOCAL_OPENCODE_SERVICE_FILE = "opencode/service.json" as const;

const CLI_PACKAGE = "@opencode-ai/cli";
const CLI_BINARY = "opencode2.exe";
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_MONITOR_INTERVAL_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const BASIC_USERNAME = "opencode";
const LOCAL_CLIENT_NAME = "oc-ui";
const FAILED_PROBES_BEFORE_UNAVAILABLE = 3;

const LocalOpenCodeFailureReasonSchema = Schema.Union([
  Schema.Literal("executable-unavailable"),
  Schema.Literal("invalid-endpoint"),
  Schema.Literal("start-failed"),
  Schema.Literal("stop-failed"),
  Schema.Literal("timed-out"),
]);
type LocalOpenCodeFailureReason = typeof LocalOpenCodeFailureReasonSchema.Type;

const localOpenCodeFailureMessages = {
  "executable-unavailable":
    "The built-in OpenCode executable is missing or incompatible. Reinstall Ocui and try again.",
  "invalid-endpoint": "The built-in OpenCode server returned invalid connection details.",
  "start-failed": "The built-in OpenCode server failed to start.",
  "stop-failed": "The built-in OpenCode server could not be stopped.",
  "timed-out": "The built-in OpenCode server did not start before the startup timeout.",
} satisfies Record<LocalOpenCodeFailureReason, string>;

type ServiceDriver = Pick<typeof OpenCodeService, "ensure" | "stop">;
type FetchLike = typeof globalThis.fetch;

type LocalOpenCodeStatus = "disconnected" | "connecting" | "connected" | "unavailable";

/** The only connection details a main-process caller needs to use the sidecar. */
type LocalOpenCodeEndpoint = {
  readonly serverUrl: string;
  readonly password: string;
};

export type LocalOpenCodeService = {
  readonly connect: () => Promise<LocalOpenCodeEndpoint>;
  readonly disconnect: () => Promise<void>;
  readonly onUnavailable: (listener: () => void) => () => void;
};

export type LocalOpenCodeServiceOptions = {
  /** The Electron app's private user-data directory. */
  readonly userDataPath?: string;
  /** An explicit app-private registration file, useful for tests. */
  readonly registrationFile?: string;
  readonly connectTimeoutMs?: number;
  readonly healthTimeoutMs?: number;
  readonly monitorIntervalMs?: number;
  readonly service?: ServiceDriver;
  readonly fetch?: FetchLike;
  readonly resolveCliBinary?: () => string;
};

export class LocalOpenCodeUnavailableError extends Schema.TaggedError<LocalOpenCodeUnavailableError>()(
  "LocalOpenCodeUnavailableError",
  {
    reason: LocalOpenCodeFailureReasonSchema,
    message: Schema.String,
  },
) {
  static fromReason(reason: LocalOpenCodeFailureReason): LocalOpenCodeUnavailableError {
    return new LocalOpenCodeUnavailableError({
      reason,
      message: localOpenCodeFailureMessages[reason],
    });
  }
}

const CliPackageJsonSchema = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.String,
    bin: Schema.Struct({ opencode2: Schema.String }),
  }),
);
const parseCliPackageJson = Schema.decodeUnknownSync(CliPackageJsonSchema);
const ServiceEndpointSchema = Schema.Struct({
  url: Schema.String,
  auth: Schema.Struct({
    type: Schema.Literal("basic"),
    username: Schema.String,
    password: Schema.NonEmptyString,
  }),
});
const parseServiceEndpoint = Schema.decodeUnknownSync(ServiceEndpointSchema);
const HealthResponseSchema = Schema.Struct({ version: Schema.String });
const parseHealthResponse = Schema.decodeUnknownSync(HealthResponseSchema);

const requireFromMain = createRequire(import.meta.url);

/** Resolve the packaged, pinned CLI binary; never fall back to a PATH command. */
function resolveLocalOpenCodeBinary(): string {
  let packageJsonPath: string;
  try {
    packageJsonPath = requireFromMain.resolve(`${CLI_PACKAGE}/package.json`);
  } catch {
    throw LocalOpenCodeUnavailableError.fromReason("executable-unavailable");
  }

  try {
    const packageJson = parseCliPackageJson(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.version !== LOCAL_OPENCODE_VERSION) {
      throw new Error("version mismatch");
    }

    const bin = packageJson.bin.opencode2;
    if (bin !== `./bin/${CLI_BINARY}`) {
      throw new Error("unexpected binary");
    }

    const binary = requireFromMain.resolve(`${CLI_PACKAGE}/bin/${CLI_BINARY}`);
    if (basename(binary) !== CLI_BINARY) {
      throw new Error("unexpected binary");
    }
    return binary;
  } catch {
    throw LocalOpenCodeUnavailableError.fromReason("executable-unavailable");
  }
}

function registrationFile(options: LocalOpenCodeServiceOptions): string {
  if (options.registrationFile !== undefined) return options.registrationFile;
  if (options.userDataPath !== undefined) {
    return join(options.userDataPath, LOCAL_OPENCODE_SERVICE_FILE);
  }
  throw LocalOpenCodeUnavailableError.fromReason("start-failed");
}

function serviceStatePath(file: string, options: LocalOpenCodeServiceOptions): string {
  if (options.userDataPath !== undefined) return options.userDataPath;
  // The service registration convention is <state>/opencode/service.json.
  // For a test-supplied non-conventional file, its containing directory is
  // the least surprising private state root.
  return basename(dirname(file)) === "opencode" ? dirname(dirname(file)) : dirname(file);
}

function endpointFromPrivate(input: OpenCodeEndpoint): LocalOpenCodeEndpoint {
  let value: typeof ServiceEndpointSchema.Type;
  try {
    value = parseServiceEndpoint(input);
  } catch {
    throw LocalOpenCodeUnavailableError.fromReason("invalid-endpoint");
  }
  if (value.auth.username !== BASIC_USERNAME) {
    throw LocalOpenCodeUnavailableError.fromReason("invalid-endpoint");
  }

  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw LocalOpenCodeUnavailableError.fromReason("invalid-endpoint");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw LocalOpenCodeUnavailableError.fromReason("invalid-endpoint");
  }

  return {
    serverUrl: url.origin,
    password: value.auth.password,
  };
}

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

async function probe(
  endpoint: LocalOpenCodeEndpoint,
  fetcher: FetchLike,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const privateEndpoint: OpenCodeEndpoint = {
      url: endpoint.serverUrl,
      auth: { type: "basic", username: BASIC_USERNAME, password: endpoint.password },
    };
    const response = await fetcher(new URL("/api/health", endpoint.serverUrl), {
      headers: OpenCodeService.headers(privateEndpoint),
      signal: timeoutSignal(timeoutMs),
    });
    if (!response.ok) return false;
    const body = parseHealthResponse(await response.json());
    return body.version === LOCAL_OPENCODE_VERSION;
  } catch {
    return false;
  }
}

function positiveMilliseconds(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Create one app-owned local OpenCode sidecar lifecycle. */
export function createLocalOpenCodeService(
  options: LocalOpenCodeServiceOptions,
): LocalOpenCodeService {
  const file = registrationFile(options);
  const service = options.service ?? OpenCodeService;
  const fetcher = options.fetch ?? globalThis.fetch;
  const connectTimeoutMs = positiveMilliseconds(
    options.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
  );
  const healthTimeoutMs = positiveMilliseconds(options.healthTimeoutMs, DEFAULT_HEALTH_TIMEOUT_MS);
  const monitorIntervalMs = positiveMilliseconds(
    options.monitorIntervalMs,
    DEFAULT_MONITOR_INTERVAL_MS,
  );
  const resolveBinary = options.resolveCliBinary ?? resolveLocalOpenCodeBinary;
  const unavailableListeners = new Set<() => void>();

  let currentStatus: LocalOpenCodeStatus = "disconnected";
  let currentEndpoint: LocalOpenCodeEndpoint | undefined;
  let ensurePromise: Promise<LocalOpenCodeEndpoint> | undefined;
  let connectPromise: Promise<LocalOpenCodeEndpoint> | undefined;
  let disconnectPromise: Promise<void> | undefined;
  let monitorController: AbortController | undefined;
  let lifecycle = 0;

  const setStatus = (next: LocalOpenCodeStatus): void => {
    if (currentStatus === next) return;
    currentStatus = next;
    if (next !== "unavailable") return;
    for (const listener of unavailableListeners) {
      try {
        listener();
      } catch {
        // A status observer cannot break process lifecycle management.
      }
    }
  };

  const stopMonitoring = (): void => {
    monitorController?.abort();
    monitorController = undefined;
  };

  const startMonitoring = (endpoint: LocalOpenCodeEndpoint, generation: number): void => {
    stopMonitoring();
    const controller = new AbortController();
    monitorController = controller;
    void (async () => {
      let failedProbes = 0;
      while (!controller.signal.aborted) {
        const elapsed = await Effect.runPromise(Effect.sleep(monitorIntervalMs), {
          signal: controller.signal,
        }).then(
          () => true,
          () => false,
        );
        if (!elapsed || controller.signal.aborted) return;
        const available = await probe(endpoint, fetcher, healthTimeoutMs);
        if (generation !== lifecycle || currentEndpoint !== endpoint) return;
        if (!available) {
          failedProbes += 1;
          if (failedProbes >= FAILED_PROBES_BEFORE_UNAVAILABLE) setStatus("unavailable");
          continue;
        }
        failedProbes = 0;
        if (currentStatus === "unavailable") setStatus("connected");
      }
    })();
  };

  const ensure = async (): Promise<LocalOpenCodeEndpoint> => {
    const binary = resolveBinary();
    const pending = service
      .ensure({
        file,
        command: [binary, "serve", "--service", "--port", "0"],
        version: LOCAL_OPENCODE_VERSION,
        env: {
          XDG_STATE_HOME: serviceStatePath(file, options),
          OPENCODE_CLIENT: LOCAL_CLIENT_NAME,
        },
      })
      .then(endpointFromPrivate);
    ensurePromise = pending;
    const clearPending = (): void => {
      if (ensurePromise === pending) ensurePromise = undefined;
    };
    void pending.then(clearPending, clearPending);
    return withTimeout(pending, connectTimeoutMs);
  };

  const connectInternal = async (generation: number): Promise<LocalOpenCodeEndpoint> => {
    setStatus("connecting");
    try {
      const endpoint = await ensure();
      if (generation !== lifecycle) {
        throw LocalOpenCodeUnavailableError.fromReason("start-failed");
      }
      currentEndpoint = endpoint;
      setStatus("connected");
      startMonitoring(endpoint, generation);
      return endpoint;
    } catch (cause) {
      if (generation === lifecycle) {
        currentEndpoint = undefined;
        stopMonitoring();
        setStatus("unavailable");
      }
      throw Schema.is(LocalOpenCodeUnavailableError)(cause)
        ? cause
        : LocalOpenCodeUnavailableError.fromReason("start-failed");
    }
  };

  const connect = (): Promise<LocalOpenCodeEndpoint> => {
    if (disconnectPromise !== undefined) {
      return disconnectPromise.then(() => connect());
    }
    if (connectPromise !== undefined) return connectPromise;
    if (ensurePromise !== undefined) {
      return ensurePromise.then(
        () => connect(),
        () => connect(),
      );
    }
    if (currentEndpoint !== undefined && currentStatus === "connected") {
      return Promise.resolve(currentEndpoint);
    }
    const generation = lifecycle;
    connectPromise = connectInternal(generation).finally(() => {
      connectPromise = undefined;
    });
    return connectPromise;
  };

  const disconnectInternal = async (): Promise<void> => {
    lifecycle += 1;
    stopMonitoring();
    currentEndpoint = undefined;
    const pendingConnect = connectPromise;
    if (pendingConnect !== undefined) {
      await pendingConnect.catch(() => undefined);
    }
    const pendingEnsure = ensurePromise;
    if (pendingEnsure !== undefined) {
      await pendingEnsure.catch(() => undefined);
    }
    try {
      await service.stop({ file });
    } catch {
      try {
        await service.stop({ file });
      } catch {
        setStatus("unavailable");
        throw LocalOpenCodeUnavailableError.fromReason("stop-failed");
      }
    }
    setStatus("disconnected");
  };

  const disconnect = (): Promise<void> => {
    if (disconnectPromise !== undefined) return disconnectPromise;
    if (currentStatus === "disconnected" && connectPromise === undefined) {
      return Promise.resolve();
    }
    disconnectPromise = disconnectInternal().finally(() => {
      disconnectPromise = undefined;
    });
    return disconnectPromise;
  };

  return {
    connect,
    disconnect,
    onUnavailable: (listener) => {
      unavailableListeners.add(listener);
      return () => unavailableListeners.delete(listener);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  const timeout = Effect.runPromise(
    Effect.sleep(milliseconds).pipe(
      Effect.andThen(Effect.fail(LocalOpenCodeUnavailableError.fromReason("timed-out"))),
    ),
    { signal: controller.signal },
  );
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    controller.abort();
  }
}
