import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const input = { serverUrl: "http://homie:4096", password: "super secret" };

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
    expect(stored).not.toContain(input.password);
    expect(loaded).toEqual(input);
  });

  it("stores only the URL when secure encryption is unavailable", async () => {
    const directory = await makeDirectory();
    const layer = settingsLayer(directory, unavailableStorage);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* Settings;
        return yield* settings.save({ serverUrl: "http://homie:4096", password: "secret" });
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
    expect(stored).toBe('{"serverUrl":"http://homie:4096"}\n');
    expect(loaded).toEqual({ serverUrl: "http://homie:4096" });
  });
});
