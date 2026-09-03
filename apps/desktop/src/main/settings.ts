import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Context, Effect, Layer, Schema } from "effect";

import type { OpenCodeTarget, SaveTargetResult } from "../shared/desktop-api.ts";

const SETTINGS_FILE_NAME = "connection-settings.json";
const MAX_URL_LENGTH = 2_048;
const MAX_PASSWORD_LENGTH = 16_384;

export interface SecureStorage {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
}

export interface SettingsService {
  readonly load: Effect.Effect<OpenCodeTarget | undefined, SettingsError>;
  readonly save: (target: OpenCodeTarget) => Effect.Effect<SaveTargetResult, SettingsError>;
  readonly clear: Effect.Effect<void, SettingsError>;
}

export const Settings = Context.Service<SettingsService>("ocui/Settings");

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  cause: Schema.Defect(),
}) {}

const StoredLocalTargetSchema = Schema.Struct({ kind: Schema.Literal("local") });
const StoredRemoteTargetSchema = Schema.Struct({
  kind: Schema.Literal("remote"),
  serverUrl: Schema.String,
  encryptedPassword: Schema.optionalKey(Schema.NonEmptyString),
});
const LegacyRemoteTargetSchema = Schema.Struct({
  serverUrl: Schema.String,
  encryptedPassword: Schema.optionalKey(Schema.NonEmptyString),
});
const WritableStoredTargetSchema = Schema.Union([
  StoredLocalTargetSchema,
  StoredRemoteTargetSchema,
]);
const StoredTargetSchema = Schema.Union([WritableStoredTargetSchema, LegacyRemoteTargetSchema]);
type WritableStoredTarget = typeof WritableStoredTargetSchema.Type;
type StoredTarget = typeof StoredTargetSchema.Type;
const StoredTargetJsonSchema = Schema.fromJsonString(StoredTargetSchema);
const WritableStoredTargetJsonSchema = Schema.fromJsonString(WritableStoredTargetSchema);
const parseStoredTarget = Schema.decodeUnknownSync(StoredTargetJsonSchema, {
  onExcessProperty: "error",
});
const encodeStoredTarget = Schema.encodeSync(WritableStoredTargetJsonSchema);

const readSettings = (filePath: string): Effect.Effect<StoredTarget | undefined> =>
  Effect.promise(async () => {
    try {
      return parseStoredTarget(await readFile(filePath, "utf8"));
    } catch {
      return undefined;
    }
  });

const writeSettings = (
  filePath: string,
  target: WritableStoredTarget,
): Effect.Effect<void, SettingsError> =>
  Effect.tryPromise({
    try: async () => {
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true });

      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const contents = `${encodeStoredTarget(target)}\n`;

      try {
        await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
        try {
          await chmod(temporaryPath, 0o600);
        } catch {
          // Windows and some filesystems do not support POSIX permissions.
        }
        await rename(temporaryPath, filePath);
      } catch (cause) {
        try {
          await unlink(temporaryPath);
        } catch {
          // The original write error is the useful failure for the caller.
        }
        throw cause;
      }
    },
    catch: (cause) => new SettingsError({ cause }),
  });

const makeSettingsService = (
  userDataPath: string,
  secureStorage: SecureStorage,
): SettingsService => {
  const filePath = join(userDataPath, SETTINGS_FILE_NAME);

  const load = Effect.gen(function* () {
    const stored = yield* readSettings(filePath);
    if (stored === undefined) return undefined;
    if ("kind" in stored && stored.kind === "local") return stored;

    const serverUrl = normalizeStoredServerUrl(stored.serverUrl);
    if (serverUrl === undefined) return undefined;

    const password = decryptStoredPassword(stored, secureStorage);
    return password === undefined
      ? { kind: "remote" as const, serverUrl }
      : { kind: "remote" as const, serverUrl, password };
  });

  const save = Effect.fn("Settings.save")(function* (target: OpenCodeTarget) {
    if (target.kind === "local") {
      yield* writeSettings(filePath, target);
      return { passwordSaved: false };
    }

    const serverUrl = normalizeServerUrl(target.serverUrl);
    const password = target.password === undefined ? undefined : validatePassword(target.password);
    const encryptedPassword =
      password === undefined ? undefined : encryptPassword(password, secureStorage);

    yield* writeSettings(
      filePath,
      encryptedPassword === undefined
        ? { kind: "remote", serverUrl }
        : { kind: "remote", serverUrl, encryptedPassword },
    );
    return { passwordSaved: encryptedPassword !== undefined };
  });

  const clear = Effect.tryPromise({
    try: async () => {
      try {
        await unlink(filePath);
      } catch (cause) {
        if (!isNodeError(cause) || cause.code !== "ENOENT") throw cause;
      }
    },
    catch: (cause) => new SettingsError({ cause }),
  });

  return { load, save, clear };
};

const normalizeStoredServerUrl = (value: string): string | undefined => {
  try {
    return normalizeServerUrl(value);
  } catch {
    return undefined;
  }
};

const decryptStoredPassword = (
  stored: { readonly encryptedPassword?: string },
  secureStorage: SecureStorage,
): string | undefined => {
  if (stored.encryptedPassword === undefined || !secureStorage.isEncryptionAvailable()) {
    return undefined;
  }

  try {
    const encryptedPassword = Buffer.from(stored.encryptedPassword, "base64");
    if (encryptedPassword.length === 0) return undefined;
    const password = secureStorage.decryptString(encryptedPassword);
    return password.length > 0 ? password : undefined;
  } catch {
    // A credential can become undecryptable after an OS profile migration.
    return undefined;
  }
};

const encryptPassword = (password: string, secureStorage: SecureStorage): string | undefined => {
  if (!secureStorage.isEncryptionAvailable()) return undefined;

  try {
    const encryptedPassword = secureStorage.encryptString(password).toString("base64");
    return encryptedPassword.length > 0 ? encryptedPassword : undefined;
  } catch {
    // Never fall back to writing the plaintext password.
    return undefined;
  }
};

const isNodeError = (cause: unknown): cause is NodeJS.ErrnoException =>
  cause instanceof Error && "code" in cause;

export const settingsLayer = (
  userDataPath: string,
  secureStorage: SecureStorage,
): Layer.Layer<SettingsService> =>
  Layer.succeed(Settings, makeSettingsService(userDataPath, secureStorage));

export const normalizeServerUrl = (value: string): string => {
  const input = value.trim();
  if (input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new TypeError("serverUrl is invalid");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("serverUrl is invalid");
  }

  if (
    url.protocol !== "http:" ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError("serverUrl must be a plain HTTP origin");
  }

  return `${url.protocol}//${url.host}`;
};

export const validatePassword = (value: string): string => {
  if (value.length === 0 || value.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError("password is invalid");
  }
  return value;
};
