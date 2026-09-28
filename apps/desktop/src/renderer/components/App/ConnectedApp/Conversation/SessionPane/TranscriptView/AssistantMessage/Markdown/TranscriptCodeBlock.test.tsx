import { Effect, Layer, ManagedRuntime } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { SyntaxHighlight, type HighlightTokens } from "#renderer/syntax-highlight.ts";
import { makeSyntaxTokenizer } from "#renderer/syntax-tokenizer.ts";
import { mount } from "#renderer/test/mount.ts";
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
    const { host, dispose } = mount(() => (
      <ThemeProvider theme={theme}>
        <SyntaxHighlightProvider highlight={highlight}>
          <Markdown text={"```ts\n" + code + "```\n\n`inline`"} />
        </SyntaxHighlightProvider>
      </ThemeProvider>
    ));
    try {
      await vi.waitFor(() => expect(host.querySelector("pre code span")).not.toBeNull());
      expect(host.querySelector("pre code")?.textContent).toBe(code);
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("pre")?.tabIndex).toBe(0);
      host.querySelector<HTMLButtonElement>("button")?.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
      expect(host.querySelector("p code span")).toBeNull();
      const light = host.querySelector<HTMLElement>("pre code span")?.style.color;
      const pre = host.querySelector("pre");
      setTheme("dark");
      await vi.waitFor(() => {
        const color = host.querySelector<HTMLElement>("pre code span")?.style.color;
        expect(color).toBeTruthy();
        expect(color).not.toBe(light);
      });
      expect(host.querySelector("pre")).toBe(pre);
      expect(host.querySelector("pre code")?.textContent).toBe(code);
    } finally {
      dispose();
      await runtime.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("ignores late results after streamed text replaces a request or the block unmounts", async () => {
    const requests: { signal: AbortSignal; resolve: (tokens: HighlightTokens) => void }[] = [];
    const highlight: HighlightCode = (_input, signal) =>
      new Promise((resolve) => requests.push({ signal, resolve }));
    const [code, setCode] = createSignal("old");
    const { host, dispose } = mount(() => (
      <SyntaxHighlightProvider highlight={highlight}>
        <TranscriptCodeBlock code={code()} language="ts" />
      </SyntaxHighlightProvider>
    ));
    setCode("new");
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[1]?.resolve([[{ content: "new", color: "var(--oc-text-base)" }]]);
    await settle();
    requests[0]?.resolve([[{ content: "old", color: "var(--oc-text-base)" }]]);
    await settle();
    expect(host.querySelector("code")?.textContent).toBe("new");
    dispose();
    expect(requests[1]?.signal.aborted).toBe(true);
  });
});
