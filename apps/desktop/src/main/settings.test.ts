import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { settingsLayer, Settings } from "./settings.ts";
import type { SecureStorage } from "./settings.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "ocui-settings-"));
  temporaryDirectories.push(directory);
  return directory;
};

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

describe("connection settings", () => {
  it("round-trips an encrypted password without writing plaintext", async () => {
    const directory = await makeDirectory();
    const layer = settingsLayer(directory, encryptedStorage);
    const input = {
      kind: "remote" as const,
      serverUrl: "http://homie:4096",
      password: "super secret",
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.save(input);
      }).pipe(Effect.provide(layer)),
    );
    const stored = await readFile(join(directory, "connection-settings.json"), "utf8");
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.load;
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ passwordSaved: true });
    expect(stored).toContain('"kind":"remote"');
    expect(stored).not.toContain(input.password);
    expect(loaded).toEqual(input);
  });

  it("stores only the URL when secure encryption is unavailable", async () => {
    const directory = await makeDirectory();
    const layer = settingsLayer(directory, unavailableStorage);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.save({
          kind: "remote",
          serverUrl: "http://homie:4096",
          password: "secret",
        });
      }).pipe(Effect.provide(layer)),
    );
    const stored = await readFile(join(directory, "connection-settings.json"), "utf8");
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.load;
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ passwordSaved: false });
    expect(stored).toBe('{"kind":"remote","serverUrl":"http://homie:4096"}\n');
    expect(loaded).toEqual({ kind: "remote", serverUrl: "http://homie:4096" });
  });

  it("saves and loads the local target without consulting secure storage", async () => {
    const directory = await makeDirectory();
    let encryptionChecked = false;
    const storage: SecureStorage = {
      ...unavailableStorage,
      isEncryptionAvailable: () => {
        encryptionChecked = true;
        return false;
      },
    };
    const layer = settingsLayer(directory, storage);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.save({ kind: "local" });
      }).pipe(Effect.provide(layer)),
    );
    const stored = await readFile(join(directory, "connection-settings.json"), "utf8");
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.load;
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ passwordSaved: false });
    expect(stored).toBe('{"kind":"local"}\n');
    expect(loaded).toEqual({ kind: "local" });
    expect(encryptionChecked).toBe(false);
  });

  it("migrates a legacy remote record while retaining its encrypted password", async () => {
    const directory = await makeDirectory();
    await writeFile(
      join(directory, "connection-settings.json"),
      '{"serverUrl":"http://homie:4096","encryptedPassword":"ZW5jcnlwdGVkOnN1cGVyIHNlY3JldA=="}\n',
    );

    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.load;
      }).pipe(Effect.provide(settingsLayer(directory, encryptedStorage))),
    );

    expect(loaded).toEqual({
      kind: "remote",
      serverUrl: "http://homie:4096",
      password: "super secret",
    });
  });

  it("allows a remote target without a password", async () => {
    const directory = await makeDirectory();
    const layer = settingsLayer(directory, encryptedStorage);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.save({ kind: "remote", serverUrl: "http://homie:4096" });
      }).pipe(Effect.provide(layer)),
    );
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.load;
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ passwordSaved: false });
    expect(loaded).toEqual({ kind: "remote", serverUrl: "http://homie:4096" });
  });
});
