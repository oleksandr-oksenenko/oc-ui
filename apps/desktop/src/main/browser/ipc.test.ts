import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { browserIpcResult } from "./ipc.ts";

describe("browser IPC settlement", () => {
  it("acknowledges success and normal interruption", async () => {
    await expect(
      Effect.runPromiseExit(Effect.void).then(browserIpcResult),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromiseExit(Effect.interrupt).then(browserIpcResult),
    ).resolves.toBeUndefined();
  });

  it.each(["failure", "defect"])(
    "preserves a real %s even alongside interruption",
    async (kind) => {
      const error = new Error("Browser operation failed");
      const cause = kind === "failure" ? Cause.fail(error) : Cause.die(error);
      for (const outcome of [cause, Cause.combine(Cause.interrupt(), cause)]) {
        await expect(Promise.resolve(Exit.failCause(outcome)).then(browserIpcResult)).rejects.toBe(
          error,
        );
      }
    },
  );
});
