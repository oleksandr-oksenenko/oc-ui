import { randomUUID } from "node:crypto";

import {
  Config,
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Queue,
  Schema,
  Scope,
} from "effect";
import type { PlatformError } from "effect";
import type { SafeStorage } from "electron";

import type { OpenCodeTarget, SaveTargetResult } from "../shared/desktop-api.ts";

const SETTINGS_FILE_NAME = "connection-settings.json";
const MAX_URL_LENGTH = 2_048;
const MAX_PASSWORD_LENGTH = 16_384;

const ServerUrlSchema = Schema.Trim.check(Schema.isLengthBetween(1, MAX_URL_LENGTH)).pipe(
  Schema.decodeTo(
    Schema.URLFromString.check(
      Schema.makeFilter((url) => url.protocol === "http:" && url.href === `${url.origin}/`, {
        message: "serverUrl must be a plain HTTP origin",
      }),
    ),
  ),
);
const parseSaveTarget = Schema.decodeEffect(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("local") }),
    Schema.Struct({
      kind: Schema.Literal("remote"),
      serverUrl: ServerUrlSchema,
      password: Schema.optionalKey(
        Schema.NonEmptyString.check(Schema.isMaxLength(MAX_PASSWORD_LENGTH)),
      ),
    }),
  ]),
  { onExcessProperty: "error" },
);

export type SecureStorage = Pick<
  SafeStorage,
  "isEncryptionAvailable" | "encryptString" | "decryptString"
>;

export class Settings extends Context.Service<
  Settings,
  {
    readonly load: Effect.Effect<OpenCodeTarget | undefined, SettingsError>;
    readonly save: (target: OpenCodeTarget) => Effect.Effect<SaveTargetResult, SettingsError>;
    readonly clear: Effect.Effect<void, SettingsError>;
    readonly shutdown: Effect.Effect<void>;
  }
>()("ocui/Settings") {}

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  cause: Schema.Defect(),
}) {}

const StoredTargetSchema = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("local") }),
    Schema.Struct({
      kind: Schema.Literal("remote"),
      serverUrl: ServerUrlSchema,
      encryptedPassword: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ]),
);
type StoredTarget = typeof StoredTargetSchema.to.Encoded;
const parseStoredTarget = Schema.decodeEffect(StoredTargetSchema, {
  onExcessProperty: "error",
});
const encodeStoredTarget = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toEncoded(StoredTargetSchema.to)),
);

const makeSettingsService = Effect.fn("Settings.make")(function* (
  userDataPath: string,
  secureStorage: SecureStorage,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(userDataPath, SETTINGS_FILE_NAME);
  const provider = yield* ConfigProvider.fromDir({ rootPath: userDataPath });
  const readSettings = Config.string(SETTINGS_FILE_NAME)
    .pipe(Config.withDefault(""))
    .parse(provider)
    .pipe(
      Effect.flatMap((contents) =>
        parseStoredTarget(contents).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  const writeSettings = Effect.fn("Settings.write")(function* (target: StoredTarget) {
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    const temporaryDirectory = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const temporaryPath = path.join(temporaryDirectory, SETTINGS_FILE_NAME);
    const contents = `${yield* encodeStoredTarget(target)}\n`;
    yield* Effect.acquireUseRelease(
      fs.makeDirectory(temporaryDirectory, { mode: 0o700 }),
      () =>
        fs
          .writeFileString(temporaryPath, contents, { flag: "wx", mode: 0o600 })
          .pipe(Effect.andThen(fs.rename(temporaryPath, filePath))),
      () => fs.remove(temporaryDirectory, { recursive: true, force: true }).pipe(Effect.ignore),
    );
  });

  const load = Effect.gen(function* () {
    const stored = yield* readSettings;
    if (stored === undefined) return undefined;
    if (stored.kind === "local") return stored;

    const serverUrl = stored.serverUrl.origin;
    const password = decryptStoredPassword(stored, secureStorage);
    return password === undefined
      ? { kind: "remote" as const, serverUrl }
      : { kind: "remote" as const, serverUrl, password };
  });

  const save = Effect.fn("Settings.save")(function* (input: OpenCodeTarget) {
    const target = yield* parseSaveTarget(input);
    if (target.kind === "local") {
      yield* writeSettings(target);
      return { passwordSaved: false };
    }

    const serverUrl = target.serverUrl.origin;
    const { password } = target;
    const encryptedPassword =
      password === undefined ? undefined : encryptPassword(password, secureStorage);

    yield* writeSettings(
      encryptedPassword === undefined
        ? { kind: "remote", serverUrl }
        : { kind: "remote", serverUrl, encryptedPassword },
    );
    return { passwordSaved: encryptedPassword !== undefined };
  });

  const clear = fs.remove(filePath, { force: true });

  const queue = yield* Queue.make<Effect.Effect<void>>();
  const requestScope = yield* Scope.make("parallel");
  let closing = false;
  const close = yield* Effect.gen(function* () {
    closing = true;
    yield* Queue.shutdown(queue);
    yield* Scope.close(requestScope, Exit.void);
  }).pipe(Effect.uninterruptible, Effect.cached);

  const worker = yield* Queue.take(queue).pipe(
    Effect.flatten,
    Effect.forever,
    Effect.ensuring(close),
    Effect.forkScoped,
  );
  const shutdown = Effect.gen(function* () {
    yield* close;
    yield* Fiber.interrupt(worker);
  }).pipe(Effect.uninterruptible);
  yield* Effect.addFinalizer(() => shutdown);

  const submit = <A>(
    operation: Effect.Effect<
      A,
      Config.ConfigError | PlatformError.PlatformError | Schema.SchemaError
    >,
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (closing) return yield* Effect.interrupt;
        const start = yield* Deferred.make<void>();
        const request = yield* Effect.gen(function* () {
          yield* Deferred.await(start);
          if (closing) return yield* Effect.interrupt;
          return yield* operation;
        }).pipe(
          Effect.mapError((cause) => new SettingsError({ cause })),
          Effect.forkIn(requestScope),
        );
        // Scope owns the request before the queue can release it. Discarding
        // an entry is safe: scope closure interrupts even requests not started.
        const offered = yield* Queue.offer(
          queue,
          Effect.gen(function* () {
            yield* Deferred.succeed(start, undefined);
            yield* Fiber.await(request);
          }),
        );
        if (!offered) yield* Fiber.interrupt(request);
        return yield* restore(Fiber.join(request)).pipe(
          Effect.onInterrupt(() => Fiber.interrupt(request)),
        );
      }),
    );

  return Settings.of({
    load: submit(load),
    save: (target: OpenCodeTarget) => submit(save(target)),
    clear: submit(clear),
    shutdown,
  });
}, Effect.uninterruptible);

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

export const settingsLayer = (
  userDataPath: string,
  secureStorage: SecureStorage,
): Layer.Layer<Settings, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(Settings, makeSettingsService(userDataPath, secureStorage));
