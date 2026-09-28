import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { makeSyntaxHighlight, MAX_HIGHLIGHT_LENGTH, SyntaxHighlight } from "./syntax-highlight.ts";

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  postMessage = vi.fn<(input: typeof snippet) => void>();
  terminate = vi.fn<() => void>();
  constructor() {
    super();
    TestWorker.instances.push(this);
  }
  respond(content = "highlighted") {
    this.dispatchEvent(new MessageEvent("message", { data: { tokens: [[{ content }]] } }));
  }
}
const snippet = { code: "const x = 1", language: "ts", theme: "light" as const };
const highlight = (input = snippet) =>
  Effect.flatMap(SyntaxHighlight, (service) => service.highlight(input));
function runtime() {
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
  return ManagedRuntime.make(SyntaxHighlight.layer);
}
afterEach(() => vi.unstubAllGlobals());

describe("SyntaxHighlight worker pool", () => {
  it("starts lazily, filters unsupported input, shares an alias-aware bounded cache", async () => {
    const owner = runtime();
    try {
      for (const language of ["", "text", "unknown", "__proto__"])
        expect(await owner.runPromise(highlight({ ...snippet, language }))).toBeUndefined();
      expect(
        await owner.runPromise(
          highlight({ ...snippet, code: "x".repeat(MAX_HIGHLIGHT_LENGTH + 1) }),
        ),
      ).toBeUndefined();
      expect(TestWorker.instances).toHaveLength(0);
      const first = owner.runPromise(highlight());
      await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
      TestWorker.instances[0]!.respond();
      const tokens = await first;
      expect(await owner.runPromise(highlight({ ...snippet, language: "typescript" }))).toBe(
        tokens,
      );
      for (let i = 0; i < 32; i++) {
        const next = owner.runPromise(highlight({ ...snippet, code: `const n = ${i}` }));
        await vi.waitFor(() =>
          expect(TestWorker.instances[0]!.postMessage).toHaveBeenCalledTimes(i + 2),
        );
        TestWorker.instances[0]!.respond();
        await next;
      }
      const evicted = owner.runPromise(highlight());
      await vi.waitFor(() =>
        expect(TestWorker.instances[0]!.postMessage).toHaveBeenCalledTimes(34),
      );
      TestWorker.instances[0]!.respond();
      await evicted;
    } finally {
      await owner.dispose();
    }
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });

  it("shares concurrent aliases and keeps work alive while another subscriber remains", async () => {
    const owner = runtime();
    const abort = new AbortController();
    const first = owner.runPromiseExit(highlight(), { signal: abort.signal });
    const others = Array.from({ length: 5 }, () =>
      owner.runPromise(highlight({ ...snippet, language: "typescript" })),
    );
    try {
      await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
      expect(TestWorker.instances).toHaveLength(1);
      abort.abort();
      expect((await first)._tag).toBe("Failure");
      expect(TestWorker.instances[0]!.terminate).not.toHaveBeenCalled();
      TestWorker.instances[0]!.respond();
      const results = await Promise.all(others);
      for (const result of results) expect(result).toBe(results[0]);
      expect(TestWorker.instances[0]!.postMessage).toHaveBeenCalledOnce();
      expect(await owner.runPromise(highlight())).toBe(results[0]);
    } finally {
      await owner.dispose();
    }
  });

  it("cancels shared work only after the last subscriber leaves and permits a retry", async () => {
    const owner = runtime();
    const a = new AbortController();
    const b = new AbortController();
    const first = owner.runPromiseExit(highlight(), { signal: a.signal });
    const second = owner.runPromiseExit(highlight(), { signal: b.signal });
    try {
      await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
      a.abort();
      await first;
      expect(TestWorker.instances[0]!.terminate).not.toHaveBeenCalled();
      b.abort();
      await second;
      expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
      const retry = owner.runPromise(highlight());
      await vi.waitFor(() => expect(TestWorker.instances[1]?.postMessage).toHaveBeenCalledOnce());
      TestWorker.instances[1]!.respond();
      expect(await retry).toBeDefined();
    } finally {
      await owner.dispose();
    }
  });

  it("limits concurrency, cancels queued work, and replaces a cancelled active worker", async () => {
    const owner = runtime();
    const active = new AbortController();
    const queued = new AbortController();
    const a = owner.runPromiseExit(highlight(), { signal: active.signal });
    const b = owner.runPromise(highlight({ ...snippet, code: "second" }));
    const c = owner.runPromiseExit(highlight({ ...snippet, code: "queued" }), {
      signal: queued.signal,
    });
    try {
      await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
      expect(TestWorker.instances.every((w) => w.postMessage.mock.calls.length === 1)).toBe(true);
      queued.abort();
      expect((await c)._tag).toBe("Failure");
      active.abort();
      expect((await a)._tag).toBe("Failure");
      await vi.waitFor(() => expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce());
      TestWorker.instances[1]!.respond();
      await b;
      const d = owner.runPromise(highlight({ ...snippet, code: "replacement" }));
      await vi.waitFor(() =>
        expect(
          TestWorker.instances
            .filter((w) => !w.terminate.mock.calls.length)
            .some((w) => w.postMessage.mock.calls.some(([input]) => input.code === "replacement")),
        ).toBe(true),
      );
      for (const worker of TestWorker.instances)
        if (!worker.terminate.mock.calls.length) worker.respond();
      await d;
      expect(
        TestWorker.instances
          .flatMap((w) => w.postMessage.mock.calls)
          .some(([input]) => input.code === "queued"),
      ).toBe(false);
    } finally {
      await owner.dispose();
    }
    for (const worker of TestWorker.instances) expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(["error", "messageerror", "malformed"])(
    "settles %s failures and retries with a new worker",
    async (kind) => {
      const owner = runtime();
      try {
        const failed = owner.runPromiseExit(highlight());
        await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
        TestWorker.instances[0]!.dispatchEvent(
          kind === "malformed"
            ? new MessageEvent("message", { data: { tokens: "invalid" } })
            : kind === "error"
              ? new ErrorEvent("error", { message: "load failed" })
              : new MessageEvent("messageerror"),
        );
        expect((await failed)._tag).toBe("Failure");
        const retry = owner.runPromise(highlight());
        await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
        TestWorker.instances[1]!.respond();
        expect(await retry).toBeDefined();
      } finally {
        await owner.dispose();
      }
    },
  );

  it("times out a worker that never responds and releases its slot", async () => {
    vi.useFakeTimers();
    const owner = runtime();
    try {
      const result = owner.runPromiseExit(highlight());
      await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await result)._tag).toBe("Failure");
      expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    } finally {
      await owner.dispose();
      vi.useRealTimers();
    }
  });

  it("interrupts pending callers and terminates all workers at shutdown", async () => {
    const owner = runtime();
    const calls = [
      owner.runPromiseExit(highlight()),
      owner.runPromiseExit(highlight({ ...snippet, code: "other" })),
    ];
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
    await owner.dispose();
    for (const call of calls) expect((await call)._tag).toBe("Failure");
    for (const worker of TestWorker.instances) expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("reports worker construction failure without breaking the renderer runtime", async () => {
    const owner = ManagedRuntime.make(
      Layer.effect(
        SyntaxHighlight,
        makeSyntaxHighlight(() => {
          throw new Error("blocked");
        }),
      ),
    );
    try {
      expect((await owner.runPromiseExit(highlight()))._tag).toBe("Failure");
    } finally {
      await owner.dispose();
    }
  });
});
