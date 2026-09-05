/* oxlint-disable vitest/no-standalone-expect -- Oxlint does not recognize it.effect callbacks. */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Layer,
  Predicate,
  Scheduler,
  Schema,
  Scope,
} from "effect";

import { settingsFileSystemLayer } from "./settings-file-system.ts";
import { settingsLayer, Settings } from "./settings.ts";
import type { SecureStorage } from "./settings.ts";

const files = { mkdir, readFile, rename, rm, writeFile };

const encryptedStorage: SecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").slice("encrypted:".length),
};

const unavailableStorage: SecureStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("encryption is unavailable");
  },
  decryptString: () => {
    throw new Error("encryption is unavailable");
  },
};

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "ocui-settings-"))),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
);

const buildSettings = Effect.fn("SettingsTest.build")(function* (
  directory: string,
  storage: SecureStorage,
  fileSystem: Parameters<typeof settingsFileSystemLayer>[0] = files,
  owner?: Scope.Scope,
) {
  const scope = owner ?? (yield* Effect.scope);
  const context = yield* Layer.buildWithScope(
    settingsLayer(directory, storage).pipe(
      Layer.provide(Layer.mergeAll(NodePath.layer, settingsFileSystemLayer(fileSystem))),
    ),
    scope,
  );
  return Context.get(context, Settings);
});

const makeSettings = Effect.fn("SettingsTest.make")(function* (
  storage: SecureStorage = encryptedStorage,
  fileSystem: Parameters<typeof settingsFileSystemLayer>[0] = files,
) {
  const directory = yield* temporaryDirectory;
  const settings = yield* buildSettings(directory, storage, fileSystem);
  return { directory, settings };
});

const readText = (path: string) => Effect.promise(() => readFile(path, "utf8"));
const writeText = (path: string, contents: string) =>
  Effect.promise(() => writeFile(path, contents));

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { wait: Effect.promise(() => promise), promise, resolve };
};

const expectCanceled = (outcome: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(outcome) && Cause.hasInterruptsOnly(outcome.cause)).toBe(true);
};

describe("connection settings", () => {
  it.effect("round-trips an encrypted password without writing plaintext", () =>
    Effect.gen(function* () {
      const { directory, settings } = yield* makeSettings();
      const input = {
        kind: "remote" as const,
        serverUrl: "http://homie:4096",
        password: "super secret",
      };

      expect(yield* settings.save(input)).toEqual({ passwordSaved: true });
      const stored = yield* readText(join(directory, "connection-settings.json"));
      expect(stored).toContain('"kind":"remote"');
      expect(stored).not.toContain(input.password);
      expect(yield* settings.load).toEqual(input);
    }),
  );

  it.effect("stores only the URL when secure encryption is unavailable", () =>
    Effect.gen(function* () {
      const { directory, settings } = yield* makeSettings(unavailableStorage);
      expect(
        yield* settings.save({
          kind: "remote",
          serverUrl: "http://homie:4096",
          password: "secret",
        }),
      ).toEqual({ passwordSaved: false });
      expect(yield* readText(join(directory, "connection-settings.json"))).toBe(
        '{"kind":"remote","serverUrl":"http://homie:4096"}\n',
      );
      expect(yield* settings.load).toEqual({ kind: "remote", serverUrl: "http://homie:4096" });
    }),
  );

  it.effect("saves local settings without consulting secure storage", () =>
    Effect.gen(function* () {
      let encryptionChecked = false;
      const { directory, settings } = yield* makeSettings({
        ...unavailableStorage,
        isEncryptionAvailable: () => {
          encryptionChecked = true;
          return false;
        },
      });

      expect(yield* settings.save({ kind: "local" })).toEqual({ passwordSaved: false });
      expect(yield* readText(join(directory, "connection-settings.json"))).toBe(
        '{"kind":"local"}\n',
      );
      expect(yield* settings.load).toEqual({ kind: "local" });
      expect(encryptionChecked).toBe(false);
    }),
  );

  it.effect.each([
    "{",
    "null",
    '{"kind":"local","unexpected":true}',
    '{"serverUrl":"http://homie:4096"}',
    '{"kind":"remote","serverUrl":"invalid"}',
    '{"kind":"remote","serverUrl":"https://homie"}',
    '{"kind":"remote","serverUrl":"http://homie/path"}',
  ])("ignores invalid stored configuration: %s", (contents) =>
    Effect.gen(function* () {
      const { directory, settings } = yield* makeSettings();
      yield* writeText(join(directory, "connection-settings.json"), contents);
      expect(yield* settings.load).toBeUndefined();
    }),
  );

  it.effect("distinguishes missing settings from a source failure", () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const missing = yield* buildSettings(directory, encryptedStorage);
      expect(yield* missing.load).toBeUndefined();

      const denied = Object.assign(new Error("denied"), { code: "EACCES" });
      const failing = yield* buildSettings(directory, encryptedStorage, {
        ...files,
        readFile: async () => Promise.reject(denied),
      });
      const error = yield* failing.load.pipe(Effect.flip);
      expect(error._tag).toBe("SettingsError");
      expect(error.cause).toMatchObject({
        _tag: "ConfigError",
        cause: { _tag: "SourceError" },
      });
    }),
  );

  it.effect("allows a remote target without a password", () =>
    Effect.gen(function* () {
      const { settings } = yield* makeSettings();
      expect(yield* settings.save({ kind: "remote", serverUrl: "http://homie:4096" })).toEqual({
        passwordSaved: false,
      });
      expect(yield* settings.load).toEqual({ kind: "remote", serverUrl: "http://homie:4096" });
    }),
  );

  it.effect("normalizes URLs and preserves password whitespace", () =>
    Effect.gen(function* () {
      const { directory, settings } = yield* makeSettings();
      yield* settings.save({
        kind: "remote",
        serverUrl: "  HTTP://HOMIE:80/  ",
        password: " secret ",
      });
      expect(yield* settings.load).toEqual({
        kind: "remote",
        serverUrl: "http://homie",
        password: " secret ",
      });
      yield* writeText(
        join(directory, "connection-settings.json"),
        '{"kind":"remote","serverUrl":"  HTTP://[::1]:4096/  "}',
      );
      expect(yield* settings.load).toEqual({
        kind: "remote",
        serverUrl: "http://[::1]:4096",
      });
    }),
  );

  it.effect("accepts the URL and password length limits", () =>
    Effect.gen(function* () {
      const { settings } = yield* makeSettings();
      const target = {
        kind: "remote" as const,
        serverUrl: `http://${"a".repeat(2_041)}`,
        password: "🔐".repeat(8_192),
      };
      yield* settings.save({ ...target, serverUrl: ` ${target.serverUrl} ` });
      expect(yield* settings.load).toEqual(target);
    }),
  );

  it.effect("rejects invalid values before encryption or I/O", () =>
    Effect.gen(function* () {
      let touched = false;
      const { settings } = yield* makeSettings(
        {
          ...encryptedStorage,
          isEncryptionAvailable: () => {
            touched = true;
            return true;
          },
        },
        {
          ...files,
          mkdir: async () => {
            touched = true;
            throw new Error("invalid settings must not touch the filesystem");
          },
        },
      );
      const invalidUrls = [
        "",
        " ",
        "invalid",
        "https://homie",
        "http://user:secret@homie",
        "http://homie/path",
        "http://homie?query",
        "http://homie#fragment",
        `http://${"a".repeat(2_042)}`,
      ];
      for (const target of [
        ...invalidUrls.map((serverUrl) => ({ serverUrl, password: "secret" })),
        ...["", "🔐".repeat(8_193)].map((password) => ({
          serverUrl: "http://homie",
          password,
        })),
      ]) {
        const error = yield* settings.save({ kind: "remote", ...target }).pipe(Effect.flip);
        expect(error._tag).toBe("SettingsError");
        expect(Schema.isSchemaError(error.cause)).toBe(true);
      }
      expect(touched).toBe(false);
    }),
  );

  it.effect("creates the temporary file exclusively with private permissions", () =>
    Effect.gen(function* () {
      let writeOptions: Parameters<typeof writeFile>[2];
      const { settings } = yield* makeSettings(encryptedStorage, {
        ...files,
        writeFile: async (path, data, options) => {
          writeOptions = options;
          await writeFile(path, data, options);
        },
      });
      yield* settings.save({ kind: "local" });
      expect(writeOptions).toMatchObject({ flag: "wx", mode: 0o600 });
    }),
  );

  it.effect.each([false, true])("preserves an unowned temporary directory (cancel: %s)", (cancel) =>
    Effect.gen(function* () {
      const started = gate();
      const release = gate();
      let removed = false;
      let collisionPath = "";
      const collision = Object.assign(new Error("collision"), { code: "EEXIST" });
      const { settings } = yield* makeSettings(encryptedStorage, {
        ...files,
        mkdir: async (path, options) => {
          if (!String(path).endsWith(".tmp")) {
            await mkdir(path, options);
            return undefined;
          }
          collisionPath = String(path);
          await mkdir(path);
          await writeFile(join(collisionPath, "sentinel"), "belongs to another creator");
          started.resolve();
          await release.promise;
          throw collision;
        },
        rm: async (path, options) => {
          if (String(path).endsWith(".tmp")) removed = true;
          await rm(path, options);
        },
      });

      const request = yield* Effect.forkChild(settings.save({ kind: "local" }));
      yield* started.wait;
      const cancellation = cancel ? yield* Effect.forkChild(Fiber.interrupt(request)) : undefined;
      yield* Effect.yieldNow;
      release.resolve();
      if (cancellation) yield* Fiber.join(cancellation);
      expect(Exit.isFailure(yield* Fiber.await(request))).toBe(true);
      if (!cancel) {
        const error = yield* Fiber.join(request).pipe(Effect.flip);
        expect(error.cause).toMatchObject({
          _tag: "PlatformError",
          reason: { _tag: "AlreadyExists" },
        });
      }
      expect(removed).toBe(false);
      expect(yield* readText(join(collisionPath, "sentinel"))).toBe("belongs to another creator");
    }),
  );
});

const blockedWrite = Effect.fn("SettingsTest.blockedWrite")(function* (owner?: Scope.Scope) {
  const started = gate();
  const aborted = gate();
  const release = gate();
  const cleanupStarted = gate();
  const cleanupRelease = gate();
  let writes = 0;
  let renames = 0;
  const directory = yield* temporaryDirectory;
  const settings = yield* buildSettings(
    directory,
    encryptedStorage,
    {
      ...files,
      writeFile: async (path, data, options) => {
        writes += 1;
        if (writes === 1) {
          const signal = options && !Predicate.isString(options) ? options.signal : undefined;
          signal?.addEventListener("abort", aborted.resolve, { once: true });
          started.resolve();
          await release.promise;
        }
        await writeFile(path, data, options);
      },
      rename: async (source, destination) => {
        renames += 1;
        await rename(source, destination);
      },
      rm: async (path, options) => {
        if (String(path).endsWith(".tmp") && writes === 1 && renames === 0) {
          cleanupStarted.resolve();
          await cleanupRelease.promise;
        }
        await rm(path, options);
      },
    },
    owner,
  );
  return {
    settings,
    started,
    aborted,
    release,
    cleanupStarted,
    cleanupRelease,
    writes: () => writes,
    renames: () => renames,
  };
});

describe("settings ownership", () => {
  it.effect("cleans the temporary file when canceled before rename", () =>
    Effect.gen(function* () {
      let interrupted = 0;
      for (let interruptAt = 1; interruptAt <= 8; interruptAt += 1) {
        let operation: Fiber.Fiber<unknown, unknown> | undefined;
        let steps = 0;
        let fired = false;
        let temporaryExists = false;
        const scheduler = new Scheduler.MixedScheduler();
        scheduler.shouldYield = (fiber) => {
          if (fiber === operation && ++steps === interruptAt) {
            fired = true;
            queueMicrotask(() => fiber.interruptUnsafe());
            return true;
          }
          return false;
        };
        const setTemporary = (exists: boolean) =>
          Effect.sync(() => {
            temporaryExists = exists;
          });
        const fileSystem = FileSystem.makeNoop({
          makeDirectory: () => Effect.void,
          writeFileString: () =>
            Effect.withFiber((fiber) => {
              operation = fiber;
              return setTemporary(true);
            }),
          rename: () => setTemporary(false),
          remove: () => setTemporary(false),
        });
        const owner = yield* Scope.make();
        const context = yield* Layer.buildWithScope(
          settingsLayer("/settings", unavailableStorage).pipe(
            Layer.provide(
              Layer.mergeAll(NodePath.layer, Layer.succeed(FileSystem.FileSystem, fileSystem)),
            ),
          ),
          owner,
        );
        const outcome = yield* Effect.exit(
          Context.get(context, Settings)
            .save({ kind: "local" })
            .pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
        );
        yield* Scope.close(owner, Exit.void);

        expect(temporaryExists).toBe(false);
        if (fired) {
          interrupted += 1;
          expectCanceled(outcome);
        }
      }
      expect(interrupted).toBeGreaterThan(0);
    }),
  );

  it.effect("submits lazily and serializes every operation", () =>
    Effect.gen(function* () {
      const io = yield* blockedWrite();
      const save = io.settings.save({ kind: "local" });
      expect(io.writes()).toBe(0);
      const saved = yield* Effect.forkChild(save);
      yield* io.started.wait;
      const loaded = yield* Effect.forkChild(io.settings.load);
      const cleared = yield* Effect.forkChild(io.settings.clear);
      const empty = yield* Effect.forkChild(io.settings.load);
      io.release.resolve();

      expect(yield* Fiber.join(saved)).toEqual({ passwordSaved: false });
      expect(yield* Fiber.join(loaded)).toEqual({ kind: "local" });
      yield* Fiber.join(cleared);
      expect(yield* Fiber.join(empty)).toBeUndefined();
      expect(io.writes()).toBe(1);
      expect(io.renames()).toBe(1);
    }),
  );

  it.effect("continues after a failure or defect without retrying", () =>
    Effect.gen(function* () {
      let writes = 0;
      const { settings } = yield* makeSettings(
        {
          ...encryptedStorage,
          isEncryptionAvailable: () => {
            throw new Error("secure storage defect");
          },
        },
        {
          ...files,
          writeFile: async (path, data, options) => {
            writes += 1;
            if (writes === 1) throw new Error("disk unavailable");
            await writeFile(path, data, options);
          },
        },
      );
      const failed = yield* Effect.exit(settings.save({ kind: "local" }));
      expect(Exit.isFailure(failed) && Cause.hasFails(failed.cause)).toBe(true);
      const defect = yield* Effect.exit(
        settings.save({ kind: "remote", serverUrl: "http://homie", password: "secret" }),
      );
      expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);
      yield* settings.save({ kind: "local" });
      expect(yield* settings.load).toEqual({ kind: "local" });
      expect(writes).toBe(2);
    }),
  );

  it.effect("skips a canceled queued caller and continues the worker", () =>
    Effect.gen(function* () {
      const io = yield* blockedWrite();
      const active = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      yield* io.started.wait;
      const queued = yield* Effect.forkChild(
        io.settings.save({ kind: "remote", serverUrl: "http://discarded" }),
      );
      const loaded = yield* Effect.forkChild(io.settings.load);
      yield* Fiber.interrupt(queued);
      expectCanceled(yield* Fiber.await(queued));
      io.release.resolve();
      yield* Fiber.join(active);
      expect(yield* Fiber.join(loaded)).toEqual({ kind: "local" });
      expect(io.writes()).toBe(1);
    }),
  );

  it.effect.each([2_048, 16])("preserves FIFO with a %i-operation scheduler budget", (budget) =>
    Effect.gen(function* () {
      const started = gate();
      const release = gate();
      const encrypted: string[] = [];
      let writes = 0;
      const { settings } = yield* makeSettings(
        {
          ...encryptedStorage,
          encryptString: (value) => {
            encrypted.push(value);
            return encryptedStorage.encryptString(value);
          },
        },
        {
          ...files,
          writeFile: async (path, data, options) => {
            if (writes++ === 0) {
              started.resolve();
              await release.promise;
            }
            await writeFile(path, data, options);
          },
        },
      );
      const first = yield* Effect.forkChild(settings.save({ kind: "local" }));
      yield* started.wait;
      const requests = [];
      for (let index = 0; index < 20; index += 1) {
        requests.push(
          yield* Effect.forkChild(
            settings
              .save({ kind: "remote", serverUrl: "http://server", password: String(index) })
              .pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, budget)),
          ),
        );
        yield* Effect.yieldNow;
      }
      for (const [index, request] of requests.entries()) {
        if (index % 2 === 1) yield* Fiber.interrupt(request);
      }
      release.resolve();
      yield* Fiber.join(first);
      const outcomes = yield* Effect.forEach(requests, Fiber.await);
      expect(outcomes.map(Exit.isSuccess)).toEqual(
        Array.from({ length: 20 }, (_, index) => index % 2 === 0),
      );
      expect(encrypted).toEqual(Array.from({ length: 10 }, (_, index) => String(index * 2)));
      expect(writes).toBe(11);
    }),
  );

  it.effect("waits for active I/O and cleanup before starting its successor", () =>
    Effect.gen(function* () {
      const io = yield* blockedWrite();
      const active = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      yield* io.started.wait;
      const next = yield* Effect.forkChild(
        io.settings.save({ kind: "remote", serverUrl: "http://next" }),
      );
      const canceling = yield* Effect.forkChild(Fiber.interrupt(active));
      yield* io.aborted.wait;
      expect(io.writes()).toBe(1);
      io.release.resolve();
      yield* io.cleanupStarted.wait;
      expect(io.writes()).toBe(1);
      expect(io.renames()).toBe(0);
      io.cleanupRelease.resolve();
      yield* Fiber.join(canceling);
      expectCanceled(yield* Fiber.await(active));
      yield* Fiber.join(next);
      expect(io.writes()).toBe(2);
      expect(yield* io.settings.load).toEqual({ kind: "remote", serverUrl: "http://next" });
    }),
  );

  it.effect("shutdown discards queued work and waits for active cleanup", () =>
    Effect.gen(function* () {
      const io = yield* blockedWrite();
      const active = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      yield* io.started.wait;
      const queuedSave = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      const queuedLoad = yield* Effect.forkChild(io.settings.load);
      const queuedClear = yield* Effect.forkChild(io.settings.clear);
      const shutdown = yield* Effect.forkChild(io.settings.shutdown);
      const again = yield* Effect.forkChild(io.settings.shutdown);
      yield* io.aborted.wait;
      expectCanceled(yield* Fiber.await(queuedSave));
      expectCanceled(yield* Fiber.await(queuedLoad));
      expectCanceled(yield* Fiber.await(queuedClear));
      expectCanceled(yield* Effect.exit(io.settings.save({ kind: "local" })));
      expect(shutdown.pollUnsafe()).toBeUndefined();
      expect(again.pollUnsafe()).toBeUndefined();
      io.release.resolve();
      yield* io.cleanupStarted.wait;
      expect(shutdown.pollUnsafe()).toBeUndefined();
      io.cleanupRelease.resolve();
      yield* Fiber.join(shutdown);
      yield* Fiber.join(again);
      expectCanceled(yield* Fiber.await(active));
      expect(io.writes()).toBe(1);
      expect(io.renames()).toBe(0);
      yield* io.settings.shutdown;
    }),
  );

  it.effect("waits for canceled directory creation before settling", () =>
    Effect.gen(function* () {
      const started = gate();
      const release = gate();
      const events: string[] = [];
      const { settings } = yield* makeSettings(encryptedStorage, {
        ...files,
        mkdir: async () => {
          started.resolve();
          await release.promise;
          return undefined;
        },
        writeFile: async (path, data, options) => {
          events.push("write");
          await writeFile(path, data, options);
        },
      });
      const active = yield* Effect.forkChild(settings.save({ kind: "local" }));
      yield* started.wait;
      const canceling = yield* Effect.forkChild(Fiber.interrupt(active));
      yield* Effect.yieldNow;
      expect(canceling.pollUnsafe()).toBeUndefined();
      expect(events).toEqual([]);
      release.resolve();
      yield* Fiber.join(canceling);
      expectCanceled(yield* Fiber.await(active));
      expect(events).toEqual([]);
    }),
  );

  it.effect("scope disposal applies the shutdown policy", () =>
    Effect.gen(function* () {
      const owner = yield* Scope.make();
      const io = yield* blockedWrite(owner);
      const active = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      yield* io.started.wait;
      const queued = yield* Effect.forkChild(io.settings.save({ kind: "local" }));
      const disposing = yield* Effect.forkChild(Scope.close(owner, Exit.void));
      yield* io.aborted.wait;
      expectCanceled(yield* Fiber.await(queued));
      expect(disposing.pollUnsafe()).toBeUndefined();
      io.release.resolve();
      yield* io.cleanupStarted.wait;
      expect(disposing.pollUnsafe()).toBeUndefined();
      io.cleanupRelease.resolve();
      yield* Fiber.join(disposing);
      expectCanceled(yield* Fiber.await(active));
      expectCanceled(yield* Effect.exit(io.settings.load));
      expect(io.writes()).toBe(1);
    }),
  );

  it.effect("retains rename ownership before allowing clear", () =>
    Effect.gen(function* () {
      const started = gate();
      const release = gate();
      const events: string[] = [];
      const { settings } = yield* makeSettings(encryptedStorage, {
        ...files,
        rename: async (source, destination) => {
          started.resolve();
          await release.promise;
          await rename(source, destination);
          events.push("rename");
        },
        rm: async (path, options) => {
          if (!String(path).endsWith(".tmp")) events.push("clear");
          await rm(path, options);
        },
      });
      const active = yield* Effect.forkChild(settings.save({ kind: "local" }));
      yield* started.wait;
      const cleared = yield* Effect.forkChild(settings.clear);
      const canceling = yield* Effect.forkChild(Fiber.interrupt(active));
      yield* Effect.yieldNow;
      expect(events).toEqual([]);
      release.resolve();
      yield* Fiber.join(canceling);
      yield* Fiber.join(cleared);
      expectCanceled(yield* Fiber.await(active));
      expect(events).toEqual(["rename", "clear"]);
      expect(yield* settings.load).toBeUndefined();
    }),
  );

  it.effect.each([2_048, 16])(
    "settles submission racing shutdown with a %i-operation scheduler budget",
    (budget) =>
      Effect.gen(function* () {
        let writes = 0;
        const { settings } = yield* makeSettings(encryptedStorage, {
          ...files,
          writeFile: async (path, data, options) => {
            writes += 1;
            await writeFile(path, data, options);
          },
        });
        yield* Effect.gen(function* () {
          const submitted = yield* Effect.forkChild(settings.save({ kind: "local" }));
          yield* settings.shutdown;
          expectCanceled(yield* Fiber.await(submitted));
        }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, budget));
        expect(writes).toBe(0);
        expectCanceled(yield* Effect.exit(settings.load));
      }),
  );
});
