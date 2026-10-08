import { Effect, Layer, ManagedRuntime } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { SyntaxHighlight, type HighlightTokens } from "#renderer/syntax-highlight.ts";
import { makeSyntaxTokenizer } from "#renderer/syntax-tokenizer.ts";
import { mount } from "#renderer/test/mount.ts";
import { deferred } from "#renderer/test/deferred.ts";
import {
  SyntaxHighlightProvider,
  type HighlightCode,
} from "#renderer/ui/SyntaxHighlightProvider.tsx";
import { ThemeProvider } from "#renderer/ui/ThemeProvider.tsx";
import type { Theme } from "#renderer/appearance.ts";
import { Markdown } from "../Markdown.tsx";
import { TranscriptCodeBlock } from "./TranscriptCodeBlock.tsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Transcript code highlighting", () => {
  it.each(["success", "failure"])("ignores late %s after owner disposal", async (outcome) => {
    const pending = deferred<HighlightTokens | undefined>();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    let requestSignal: AbortSignal | undefined;
    const { host, dispose } = mount(() => (
      <ThemeProvider theme={() => "light"}>
        <SyntaxHighlightProvider
          highlight={(_, signal) => {
            requestSignal = signal;
            return pending.promise;
          }}
        >
          <TranscriptCodeBlock code="Disposed source" language="ts" />
        </SyntaxHighlightProvider>
      </ThemeProvider>
    ));
    try {
      await vi.waitFor(() => expect(requestSignal).toBeDefined());
      const pre = host.querySelector("pre")!;
      dispose();
      expect(requestSignal?.aborted).toBe(true);
      if (outcome === "success") pending.resolve([[{ content: "Late tokens" }]]);
      else pending.reject(new Error("Late failure"));
      await settle();
      expect(pre.isConnected).toBe(false);
      expect(pre.textContent).not.toContain("Late tokens");
      expect(report).not.toHaveBeenCalled();
    } finally {
      dispose();
      report.mockRestore();
    }
  });

  it("preserves unchanged blocks during streaming and cancels only replaced or removed blocks", async () => {
    const prefix = "```ts\nconst x = 1;\n```\n\n";
    const [text, setText] = createSignal(prefix + "A");
    const requests: AbortSignal[] = [];
    const { host, dispose } = mount(() => (
      <ThemeProvider theme={() => "light"}>
        <SyntaxHighlightProvider
          highlight={(_, signal) => {
            requests.push(signal);
            return new Promise(() => {});
          }}
        >
          <Markdown text={text()} />
        </SyntaxHighlightProvider>
      </ThemeProvider>
    ));
    try {
      await settle();
      const pre = host.querySelector("pre");
      setText(prefix + "AB");
      await settle();
      setText(prefix + "ABC");
      await settle();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.aborted).toBe(false);
      expect(host.querySelector("pre")).toBe(pre);
      setText(prefix + "ABC\n\n```ts\nconst y = 2;\n```\n");
      await settle();
      expect(requests).toHaveLength(2);
      expect(requests[0]!.aborted).toBe(false);
      setText(prefix.replace("const x = 1", "const x = 3"));
      await settle();
      expect(requests).toHaveLength(3);
      expect(requests[0]!.aborted).toBe(true);
      expect(requests[1]!.aborted).toBe(true);
      expect(requests[2]!.aborted).toBe(false);
      expect(host.querySelector("pre code")?.textContent).toBe("const x = 3;\n");
    } finally {
      dispose();
    }
    expect(requests[2]!.aborted).toBe(true);
  });

  it("preserves source text and safely renders real Shiki tokens in both themes", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
    const runtime = ManagedRuntime.make(Layer.effect(SyntaxHighlight, makeSyntaxTokenizer()));
    const highlight: HighlightCode = (input, signal) =>
      runtime.runPromise(
        Effect.gen(function* () {
          return yield* (yield* SyntaxHighlight).highlight(input);
        }),
        { signal },
      );
    const [theme, setTheme] = createSignal<Theme>("light");
    const code = '\tconst html = "<img src=x onerror=alert(1)> & 😀";\n\nconst next = true;\n';
    let dispose: (() => void) | undefined;
    try {
      // Initialize this runtime's tokenizer and grammar before observing rendering.
      await highlight({ code, language: "ts", theme: "light" }, new AbortController().signal);
      const mounted = mount(() => (
        <ThemeProvider theme={theme}>
          <SyntaxHighlightProvider highlight={highlight}>
            <Markdown text={"```ts\n" + code + "```\n\n`inline`"} />
          </SyntaxHighlightProvider>
        </ThemeProvider>
      ));
      const { host } = mounted;
      dispose = mounted.dispose;
      await vi.waitFor(() => expect(host.querySelector("pre code span")).not.toBeNull(), {
        timeout: 5_000,
      });
      expect(host.querySelector("pre code")?.textContent).toBe(code);
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("pre")?.tabIndex).toBe(0);
      host.querySelector<HTMLButtonElement>("button")?.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
      expect(host.querySelector("p code span")).toBeNull();
      const light = host.querySelector<HTMLElement>("pre code span")?.style.color;
      expect(light).toBeTruthy();
      const pre = host.querySelector("pre");
      setTheme("dark");
      await vi.waitFor(
        () => {
          const color = host.querySelector<HTMLElement>("pre code span")?.style.color;
          expect(color).toBeTruthy();
          expect(color).not.toBe(light);
        },
        { timeout: 5_000 },
      );
      expect(host.querySelector("pre")).toBe(pre);
      expect(host.querySelector("pre code")?.textContent).toBe(code);
    } finally {
      dispose?.();
      await runtime.dispose();
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it.each(["undefined", "rejection"])(
    "keeps %s fallback safe and recovers on the next request",
    async (kind) => {
      const requests: {
        resolve: (tokens: HighlightTokens | undefined) => void;
        reject: (error: Error) => void;
      }[] = [];
      const highlight: HighlightCode = () =>
        new Promise((resolve, reject) => requests.push({ resolve, reject }));
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const original = "<img src=x onerror=alert(1)> & 😀\n";
      const [code, setCode] = createSignal(original);
      const { host, dispose } = mount(() => (
        <SyntaxHighlightProvider highlight={highlight}>
          <TranscriptCodeBlock code={code()} language="ts" />
        </SyntaxHighlightProvider>
      ));
      try {
        const pre = host.querySelector("pre");
        const error = new Error("highlight failed");
        if (kind === "undefined") requests[0]!.resolve(undefined);
        else requests[0]!.reject(error);
        await settle();
        expect(host.querySelector("code")?.textContent).toBe(original);
        expect(host.querySelector("code span")).toBeNull();
        expect(host.querySelector("img")).toBeNull();
        expect(report.mock.calls).toEqual(
          kind === "rejection" ? [["Syntax highlighting failed", error]] : [],
        );
        host.querySelector<HTMLButtonElement>("button")!.click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(original));
        setCode("recovered");
        requests[1]!.resolve([[{ content: "recovered", color: "var(--oc-text-base)" }]]);
        await vi.waitFor(() =>
          expect(host.querySelector("code span")?.textContent).toBe("recovered"),
        );
        expect(host.querySelector("pre")).toBe(pre);
      } finally {
        dispose();
        report.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(["success", "failure"])(
    "ignores late %s after streamed text replaces a request",
    async (kind) => {
      const requests: {
        signal: AbortSignal;
        resolve: (tokens: HighlightTokens) => void;
        reject: (error: Error) => void;
      }[] = [];
      const highlight: HighlightCode = (_input, signal) =>
        new Promise((resolve, reject) => requests.push({ signal, resolve, reject }));
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      const [code, setCode] = createSignal("old");
      const { host, dispose } = mount(() => (
        <SyntaxHighlightProvider highlight={highlight}>
          <TranscriptCodeBlock code={code()} language="ts" />
        </SyntaxHighlightProvider>
      ));
      try {
        const pre = host.querySelector("pre");
        setCode("new");
        expect(requests[0]!.signal.aborted).toBe(true);
        requests[1]!.resolve([[{ content: "new", color: "var(--oc-text-base)" }]]);
        await vi.waitFor(() => expect(host.querySelector("code span")?.textContent).toBe("new"));
        if (kind === "success")
          requests[0]!.resolve([[{ content: "old", color: "var(--oc-text-base)" }]]);
        else requests[0]!.reject(new Error("stale failure"));
        await settle();
        expect(host.querySelector("code span")?.textContent).toBe("new");
        expect(host.querySelector("pre")).toBe(pre);
        expect(report).not.toHaveBeenCalled();
      } finally {
        dispose();
        report.mockRestore();
      }
      expect(requests[1]?.signal.aborted).toBe(true);
    },
  );
});
