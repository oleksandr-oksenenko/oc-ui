import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Context, Effect, Layer } from "effect";

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
  readonly load: () => Effect.Effect<LoadedConnection | undefined, unknown>;
  readonly save: (input: SaveConnectionInput) => Effect.Effect<SaveConnectionResult, unknown>;
  readonly clear: () => Effect.Effect<void, unknown>;
}

export const Settings = Context.Service<SettingsService>("ocui/Settings");

type StoredSettings = {
  readonly serverUrl: string;
  readonly encryptedPassword?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const decodeStoredSettings = (value: unknown): StoredSettings | undefined => {
  if (!isRecord(value) || typeof value.serverUrl !== "string") {
    return undefined;
  }

  if (
    value.encryptedPassword !== undefined &&
    (typeof value.encryptedPassword !== "string" || value.encryptedPassword.length === 0)
  ) {
    return undefined;
  }

  return {
    serverUrl: value.serverUrl,
    ...(value.encryptedPassword === undefined
      ? {}
      : { encryptedPassword: value.encryptedPassword }),
  };
};

const readSettings = (filePath: string): Effect.Effect<StoredSettings | undefined, unknown> =>
  Effect.tryPromise({
    try: async () => {
      let contents: string;
      try {
        contents = await readFile(filePath, "utf8");
      } catch {
        return undefined;
      }

      try {
        return decodeStoredSettings(JSON.parse(contents) as unknown);
      } catch {
        return undefined;
      }
    },
    catch: (cause) => cause,
  });

const writeSettings = (filePath: string, settings: StoredSettings): Effect.Effect<void, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true });

      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const contents = `${JSON.stringify(settings)}\n`;

      try {
        await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
        try {
          await chmod(temporaryPath, 0o600);
        } catch {
          // Windows and some filesystems do not support POSIX permissions.
        }
        await rename(temporaryPath, filePath);
      } catch (error) {
        try {
          await unlink(temporaryPath);
        } catch {
          // The original write error is the useful failure for the caller.
        }
        throw error;
      }
    },
    catch: (cause) => cause,
  });

const makeSettingsService = (
  userDataPath: string,
  secureStorage: SecureStorage,
): SettingsService => {
  const filePath = join(userDataPath, SETTINGS_FILE_NAME);

  return {
    load: () =>
      Effect.gen(function* () {
        const stored = yield* readSettings(filePath);
        if (stored === undefined) {
          return undefined;
        }

        let serverUrl: string;
        try {
          serverUrl = normalizeServerUrl(stored.serverUrl);
        } catch {
          return undefined;
        }

        if (stored.encryptedPassword === undefined || !secureStorage.isEncryptionAvailable()) {
          return { serverUrl };
        }

        try {
          const encryptedPassword = Buffer.from(stored.encryptedPassword, "base64");
          if (encryptedPassword.length === 0) {
            return { serverUrl };
          }
          const password = secureStorage.decryptString(encryptedPassword);
          return password.length > 0 ? { serverUrl, password } : { serverUrl };
        } catch {
          // A credential can become undecryptable after an OS profile migration.
          // Keep the URL so the user can re-enter the password.
          return { serverUrl };
        }
      }),

    save: (input) =>
      Effect.gen(function* () {
        const serverUrl = normalizeServerUrl(input.serverUrl);
        const password = validatePassword(input.password);
        let encryptedPassword: string | undefined;
        let passwordSaved = false;

        if (secureStorage.isEncryptionAvailable()) {
          try {
            encryptedPassword = secureStorage.encryptString(password).toString("base64");
            passwordSaved = encryptedPassword.length > 0;
          } catch {
            // Never fall back to writing the plaintext password.
            encryptedPassword = undefined;
          }
        }

        yield* writeSettings(
          filePath,
          encryptedPassword === undefined ? { serverUrl } : { serverUrl, encryptedPassword },
        );
        return { passwordSaved };
      }),

    clear: () =>
      Effect.tryPromise({
        try: async () => {
          try {
            await unlink(filePath);
          } catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
              throw error;
            }
          }
        },
        catch: (cause) => cause,
      }),
  };
};

const isNodeError = (value: unknown): value is NodeJS.ErrnoException =>
  value instanceof Error && "code" in value;

export const makeSettingsLayer = (
  userDataPath: string,
  secureStorage: SecureStorage,
): Layer.Layer<SettingsService> =>
  Layer.succeed(Settings, makeSettingsService(userDataPath, secureStorage));

export const normalizeServerUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new TypeError("serverUrl must be a string");
  }

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

export const validatePassword = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError("password is invalid");
  }
  return value;
};
