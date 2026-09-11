import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readPromptFile } from "./read-prompt-file.ts";

afterEach(() => vi.unstubAllGlobals());

describe("readPromptFile", () => {
  it("aborts a pending read when its owner is interrupted", async () => {
    const abort = vi.fn<() => void>();
    const read = vi.fn<(file: Blob) => void>();
    class PendingReader extends EventTarget {
      static readonly LOADING = 1;
      readonly readyState = 1;
      readonly readAsDataURL = read;
      readonly abort = abort;
    }
    vi.stubGlobal("FileReader", PendingReader);
    const fiber = Effect.runFork(readPromptFile(new File(["pending"], "notes.txt")));
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(abort).toHaveBeenCalledOnce();
  });

  it("reports an unreadable file without leaving the caller pending", async () => {
    class FailedReader extends EventTarget {
      static readonly LOADING = 1;
      readonly readyState = 2;
      readAsDataURL() {
        this.dispatchEvent(new Event("error"));
      }
    }
    vi.stubGlobal("FileReader", FailedReader);
    const result = await Effect.runPromise(
      Effect.result(readPromptFile(new File([], "missing.txt"))),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PromptFileReadError", name: "missing.txt" },
    });
  });
});
