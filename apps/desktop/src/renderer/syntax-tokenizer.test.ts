import { Effect, Layer, ManagedRuntime } from "effect";
import { createHighlighter } from "shiki";
import { describe, expect, it, vi } from "vite-plus/test";

import { SyntaxHighlight } from "./syntax-highlight.ts";
import { makeSyntaxTokenizer } from "./syntax-tokenizer.ts";
import { syntaxThemes } from "./syntax-theme.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// The renderer resolves aliases before dispatching canonical IDs to the tokenizer.
const snippet = { code: 'const x = "hello";\n\n', language: "typescript", theme: "light" as const };
const create = () => createHighlighter({ themes: Object.values(syntaxThemes), langs: [] });
function runtime(factory = create) {
  return ManagedRuntime.make(Layer.effect(SyntaxHighlight, makeSyntaxTokenizer(factory)));
}
function highlight(input: import("./syntax-highlight.ts").HighlightSnippet = snippet) {
  return Effect.gen(function* () {
    return yield* (yield* SyntaxHighlight).highlight(input);
  });
}

describe("SyntaxTokenizer", () => {
  it("preserves cold and warm source text and uses theme colors with one highlighter", async () => {
    const factory = vi.fn<typeof create>(create);
    const owner = runtime(factory);
    try {
      const first = await owner.runPromise(highlight());
      const warm = await owner.runPromise(highlight());
      const dark = await owner.runPromise(highlight({ ...snippet, theme: "dark" }));
      // Shiki's time budget can change token boundaries between cold and warm runs.
      for (const tokens of [first, warm, dark]) {
        expect(tokens?.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(
          snippet.code,
        );
        const colors = tokens
          ?.flat()
          .map((token) => token.color)
          .filter(Boolean);
        expect(colors?.length).toBeGreaterThan(0);
        for (const color of colors ?? []) expect(color).toMatch(/^#[\da-f]{6}$/i);
      }
      expect(dark?.[0]?.[0]?.color).not.toBe(first?.[0]?.[0]?.color);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      await owner.dispose();
    }
  });

  it("reports initialization failure", async () => {
    const owner = runtime(() => Promise.reject(new Error("load failed")));
    try {
      await expect(owner.runPromise(highlight())).rejects.toMatchObject({
        _tag: "SyntaxHighlightError",
      });
    } finally {
      await owner.dispose();
    }
  });

  it("retries a failed grammar load without recreating the highlighter", async () => {
    const instance = await create();
    const load = vi
      .spyOn(instance, "loadLanguage")
      .mockRejectedValueOnce(new Error("grammar failed"));
    const owner = runtime(() => Promise.resolve(instance));
    try {
      await expect(owner.runPromise(highlight())).rejects.toMatchObject({
        _tag: "SyntaxHighlightError",
      });
      expect(await owner.runPromise(highlight())).toBeDefined();
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await owner.dispose();
    }
  });

  it("settles non-abortable initialization before shutdown and disposes exactly once", async () => {
    const instance = await create();
    const dispose = vi.spyOn(instance, "dispose");
    const tokenize = vi.spyOn(instance, "codeToTokens");
    const loading = deferred<typeof instance>();
    const started = deferred<void>();
    const owner = runtime(() => {
      started.resolve(undefined);
      return loading.promise;
    });
    const result = owner.runPromiseExit(highlight());
    await started.promise;
    let closed = false;
    const closing = owner.dispose().then(() => {
      closed = true;
      return undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    loading.resolve(instance);
    expect(await result).toMatchObject({ _tag: "Failure" });
    await closing;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(tokenize).not.toHaveBeenCalled();
  });
});
