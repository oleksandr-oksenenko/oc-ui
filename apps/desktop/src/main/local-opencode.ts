import { randomBytes } from "node:crypto";

import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { Deferred, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

import { OPENCODE_VERSION } from "../shared/desktop-api.ts";
import type { LocalOpenCodeConnection } from "../shared/desktop-api.ts";
import { parseWorkerMessage } from "../shared/opencode-worker-contract.ts";
import type { OpenCodeWorkerCommand } from "../shared/opencode-worker-contract.ts";

export const LOCAL_OPENCODE_VERSION = OPENCODE_VERSION;
const START_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 2_000;
const STOP_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 2_000;
const HealthResponseSchema = Schema.Struct({ version: Schema.String, pid: Schema.Int });

const FailureReasonSchema = Schema.Literals([
  "invalid-endpoint",
  "start-failed",
  "stop-failed",
  "timed-out",
]);
type FailureReason = typeof FailureReasonSchema.Type;
const failureMessages = {
  "invalid-endpoint": "The built-in OpenCode server returned invalid connection details.",
  "start-failed": "The built-in OpenCode server failed to start.",
  "stop-failed": "The built-in OpenCode server could not be stopped.",
  "timed-out": "The built-in OpenCode server did not start before the startup timeout.",
} satisfies Record<FailureReason, string>;

export class LocalOpenCodeUnavailableError extends Schema.TaggedError<LocalOpenCodeUnavailableError>()(
  "LocalOpenCodeUnavailableError",
  { reason: FailureReasonSchema, message: Schema.String },
) {
  static fromReason(reason: FailureReason): LocalOpenCodeUnavailableError {
    return new LocalOpenCodeUnavailableError({ reason, message: failureMessages[reason] });
  }
}

export type LocalOpenCodeService = {
  readonly connect: () => Promise<LocalOpenCodeConnection>;
  readonly needsQuitConfirmation: () => boolean;
  readonly shutdown: () => Promise<void>;
  readonly onUnavailable: (listener: () => void) => () => void;
};

type Run = {
  readonly child: UtilityProcess;
  readonly abort: AbortController;
  readonly exit: Promise<void>;
  readonly start: Promise<LocalOpenCodeConnection>;
  exited: boolean;
  started: boolean;
  endpoint?: LocalOpenCodeConnection;
  failure?: LocalOpenCodeUnavailableError;
  stopping?: Promise<void>;
};

/** One lazy, app-owned process. Only confirmed exit releases its ownership. */
export function createLocalOpenCodeService(options: {
  readonly userDataPath: string;
  readonly workerPath: string;
}): LocalOpenCodeService {
  const listeners = new Set<() => void>();
  let current: Run | undefined;
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;

  const notifyUnavailable = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Observers cannot take ownership of process cleanup.
      }
    }
  };

  const stop = (run: Run): Promise<void> => {
    if (run.stopping !== undefined) return run.stopping;
    if (run.exited) return Promise.resolve();
    run.abort.abort();
    run.endpoint = undefined;
    run.stopping = (async () => {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
        run.child.postMessage({ type: "stop" } satisfies OpenCodeWorkerCommand);
      } catch {
        // A broken message port still leaves a child to terminate and reap.
      }
      if (await waitForExit(run, STOP_TIMEOUT_MS)) return;
      if (current !== run || run.exited) return;
      try {
        run.child.kill();
      } catch {
        // Continue to the bounded child-only fallback.
      }
      if (await waitForExit(run, KILL_TIMEOUT_MS)) return;
      if (current !== run || run.exited) return;
      const pid = run.child.pid;
      if (process.platform !== "win32" && pid !== undefined && pid > 0) {
        try {
          // Never a process group, name lookup, or remembered PID from an old run.
          process.kill(pid, "SIGKILL");
        } catch {
          // Even ESRCH is not a substitute for Electron's exit notification.
        }
      }
      if (await waitForExit(run, KILL_TIMEOUT_MS)) return;
      run.failure = LocalOpenCodeUnavailableError.fromReason("stop-failed");
      throw run.failure;
    })().finally(() => {
      run.stopping = undefined;
    });
    return run.stopping;
  };

  const connect = (): Promise<LocalOpenCodeConnection> => {
    if (closed) return Promise.reject(LocalOpenCodeUnavailableError.fromReason("start-failed"));
    if (current !== undefined) {
      // Startup callers share cleanup as well as boot; no early timeout rejection.
      if (!current.started) return current.start;
      if (current.failure !== undefined) {
        const failure = current.failure;
        return (current.stopping ?? Promise.resolve()).then(() => Promise.reject(failure));
      }
      if (current.endpoint !== undefined) return Promise.resolve(current.endpoint);
      return current.start;
    }

    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(options.workerPath, [], {
        serviceName: "Ocui built-in OpenCode",
        stdio: "pipe",
      });
    } catch {
      return Promise.reject(LocalOpenCodeUnavailableError.fromReason("start-failed"));
    }
    const password = randomBytes(32).toString("base64url");
    const abort = new AbortController();
    const exited = Deferred.makeUnsafe<void>();
    const ready = Deferred.makeUnsafe<LocalOpenCodeConnection, LocalOpenCodeUnavailableError>();
    const run: Run = {
      child,
      abort,
      exit: Effect.runPromise(Deferred.await(exited)),
      exited: false,
      started: false,
      start: Effect.runPromise(Deferred.await(ready)).catch(async (cause: unknown) => {
        await stop(run);
        throw cause;
      }),
    };
    current = run;

    const fail = (reason: FailureReason): void => {
      if (current !== run || run.exited || run.failure !== undefined) return;
      const wasRunning = run.endpoint !== undefined;
      run.failure = LocalOpenCodeUnavailableError.fromReason(reason);
      run.endpoint = undefined;
      deadline.abort();
      Effect.runSync(Deferred.fail(ready, run.failure));
      abort.abort();
      if (wasRunning) {
        void stop(run).catch(() => undefined);
        notifyUnavailable();
      }
    };
    const deadline = new AbortController();
    void Effect.runPromise(Effect.sleep(START_TIMEOUT_MS), { signal: deadline.signal }).then(
      () => fail("timed-out"),
      () => undefined,
    );
    const onAbort = (): void => {
      deadline.abort();
      Effect.runSync(
        Deferred.fail(
          ready,
          run.failure ?? LocalOpenCodeUnavailableError.fromReason("start-failed"),
        ),
      );
    };
    abort.signal.addEventListener("abort", onAbort, { once: true });
    const onSpawn = (): void => {
      if (current !== run || run.exited || abort.signal.aborted) return;
      try {
        const command: OpenCodeWorkerCommand = {
          type: "start",
          userDataPath: options.userDataPath,
          password,
        };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
        child.postMessage(command);
      } catch {
        fail("start-failed");
      }
    };
    let listening = false;
    const onMessage = (input: Parameters<typeof parseWorkerMessage>[0]): void => {
      if (current !== run || run.exited || abort.signal.aborted) return;
      try {
        const message = parseWorkerMessage(input);
        if (message.type === "fatal") {
          fail("start-failed");
          return;
        }
        if (listening) {
          fail("invalid-endpoint");
          return;
        }
        const endpoint = { serverUrl: validateEndpoint(message.url), password };
        listening = true;
        void waitUntilReady(run, endpoint).then(
          () => {
            if (current !== run || abort.signal.aborted || run.exited) return;
            deadline.abort();
            run.started = true;
            run.endpoint = endpoint;
            Effect.runSync(Deferred.succeed(ready, endpoint));
            return;
          },
          () => fail("start-failed"),
        );
      } catch {
        fail("invalid-endpoint");
      }
    };
    const onError = (): void => fail("start-failed");
    const onExit = (): void => {
      if (run.exited) return;
      const wasRunning = run.endpoint !== undefined;
      run.exited = true;
      run.endpoint = undefined;
      deadline.abort();
      abort.abort();
      Effect.runSync(Deferred.succeed(exited, undefined));
      child.off("spawn", onSpawn);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      abort.signal.removeEventListener("abort", onAbort);
      if (current !== run) return;
      current = undefined;
      if (!closed && wasRunning) notifyUnavailable();
    };
    child.on("spawn", onSpawn);
    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
    // Drain library output without copying provider or plugin secrets into main logs.
    child.stdout?.resume();
    child.stderr?.resume();
    return run.start;
  };

  return {
    connect,
    needsQuitConfirmation: () => current !== undefined,
    shutdown: () => {
      if (shutdownPromise !== undefined) return shutdownPromise;
      closed = true;
      const run = current;
      shutdownPromise = (async () => {
        if (run === undefined) return;
        await stop(run);
        await run.start.catch(() => undefined);
      })().finally(() => {
        shutdownPromise = undefined;
      });
      return shutdownPromise;
    },
    onUnavailable: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid owned endpoint");
  return url.origin;
}

async function waitUntilReady(run: Run, endpoint: LocalOpenCodeConnection): Promise<void> {
  while (!run.abort.signal.aborted) {
    const probe = new AbortController();
    const cancel = (): void => probe.abort();
    run.abort.signal.addEventListener("abort", cancel, { once: true });
    const timeout = new AbortController();
    void Effect.runPromise(Effect.sleep(HEALTH_TIMEOUT_MS), { signal: timeout.signal }).then(
      cancel,
      () => undefined,
    );
    try {
      const ready = await Effect.runPromise(
        Effect.gen(function* () {
          const response = yield* HttpClient.get(new URL("/api/health", endpoint.serverUrl), {
            headers: {
              authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
            },
          });
          if (response.status === 503) return false;
          if (response.status !== 200)
            return yield* LocalOpenCodeUnavailableError.fromReason("start-failed");
          const body = yield* HttpClientResponse.schemaBodyJson(HealthResponseSchema)(response);
          if (
            body.version !== LOCAL_OPENCODE_VERSION ||
            body.pid !== run.child.pid ||
            run.child.pid === undefined
          ) {
            return yield* LocalOpenCodeUnavailableError.fromReason("start-failed");
          }
          return true;
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This bounded health request is a host entry point; no scoped client escapes.
        }).pipe(Effect.provide(FetchHttpClient.layer)),
        { signal: probe.signal },
      );
      if (ready) return;
    } catch (cause) {
      if (!probe.signal.aborted) throw cause;
    } finally {
      timeout.abort();
      run.abort.signal.removeEventListener("abort", cancel);
    }
    await Effect.runPromise(Effect.sleep(100), { signal: run.abort.signal });
  }
  throw new Error("Startup canceled");
}

async function waitForExit(run: Run, milliseconds: number): Promise<boolean> {
  if (run.exited) return true;
  const timer = new AbortController();
  try {
    return await Promise.race([
      run.exit.then(() => true),
      Effect.runPromise(Effect.sleep(milliseconds), { signal: timer.signal }).then(() => false),
    ]);
  } finally {
    timer.abort();
  }
}
