import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Context, Effect, Layer, Schema } from "effect";

import type {
  LoadedConnection,
  SaveConnectionInput,
  SaveConnectionResult,
} from "../shared/desktop-api.ts";

const SETTINGS_FILE_NAME = "connection-settings.json";
const MAX_URL_LENGTH = 2_048;
const MAX_PASSWORD_LENGTH = 16_384;

export interface SecureStorage {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
}

export interface SettingsService {
  readonly load: Effect.Effect<LoadedConnection | undefined, SettingsError>;
  readonly save: (input: SaveConnectionInput) => Effect.Effect<SaveConnectionResult, SettingsError>;
  readonly clear: Effect.Effect<void, SettingsError>;
}

export const Settings = Context.Service<SettingsService>("oc-ui/Settings");

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  cause: Schema.Defect(),
}) {}

const StoredSettingsSchema = Schema.Struct({
  serverUrl: Schema.String,
  encryptedPassword: Schema.optionalKey(Schema.NonEmptyString),
});
type StoredSettings = typeof StoredSettingsSchema.Type;
const StoredSettingsJsonSchema = Schema.fromJsonString(StoredSettingsSchema);
const parseStoredSettings = Schema.decodeUnknownSync(StoredSettingsJsonSchema, {
  onExcessProperty: "error",
});
const encodeStoredSettings = Schema.encodeSync(StoredSettingsJsonSchema);

const readSettings = (filePath: string): Effect.Effect<StoredSettings | undefined> =>
  Effect.promise(async () => {
    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch {
      return undefined;
    }

    try {
      return parseStoredSettings(contents);
    } catch {
      return undefined;
    }
  });

const writeSettings = (
  filePath: string,
  settings: StoredSettings,
): Effect.Effect<void, SettingsError> =>
  Effect.tryPromise({
    try: async () => {
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true });

      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const contents = `${encodeStoredSettings(settings)}\n`;

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
    if (stored === undefined) {
      return undefined;
    }

    const serverUrl = normalizeStoredServerUrl(stored.serverUrl);
    if (serverUrl === undefined) {
      return undefined;
    }

    const password = decryptStoredPassword(stored, secureStorage);
    return password === undefined ? { serverUrl } : { serverUrl, password };
  });

  const save = Effect.fn("Settings.save")(function* (input: SaveConnectionInput) {
    const serverUrl = normalizeServerUrl(input.serverUrl);
    const password = validatePassword(input.password);
    const encryptedPassword = encryptPassword(password, secureStorage);

    yield* writeSettings(
      filePath,
      encryptedPassword === undefined ? { serverUrl } : { serverUrl, encryptedPassword },
    );
    return { passwordSaved: encryptedPassword !== undefined };
  });

  const clear = Effect.tryPromise({
    try: async () => {
      try {
        await unlink(filePath);
      } catch (cause) {
        if (!isNodeError(cause) || cause.code !== "ENOENT") {
          throw cause;
        }
      }
    },
    catch: (cause) => new SettingsError({ cause }),
  });

  return {
    load,
    save,
    clear,
  };
};

const normalizeStoredServerUrl = (value: string): string | undefined => {
  try {
    return normalizeServerUrl(value);
  } catch {
    return undefined;
  }
};

const decryptStoredPassword = (
  stored: StoredSettings,
  secureStorage: SecureStorage,
): string | undefined => {
  if (stored.encryptedPassword === undefined || !secureStorage.isEncryptionAvailable()) {
    return undefined;
  }

  try {
    const encryptedPassword = Buffer.from(stored.encryptedPassword, "base64");
    if (encryptedPassword.length === 0) {
      return undefined;
    }
    const password = secureStorage.decryptString(encryptedPassword);
    return password.length > 0 ? password : undefined;
  } catch {
    // A credential can become undecryptable after an OS profile migration.
    return undefined;
  }
};

const encryptPassword = (password: string, secureStorage: SecureStorage): string | undefined => {
  if (!secureStorage.isEncryptionAvailable()) {
    return undefined;
  }

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
