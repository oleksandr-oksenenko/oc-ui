import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { mount } from "../../../../../../../test/mount.ts";
import { Markdown } from "./Markdown.tsx";

const unsafeMarkdown = (name: string, value: number) =>
  [
    `## ${name}`,
    "",
    '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
    "<script>alert(1)</script>",
    '<img src="x" onerror="alert(1)" alt="shot">',
    "",
    "```ts",
    `const ${name} = ${value};`,
    "```",
  ].join("\n");

describe("Markdown", () => {
  it("copies code without markup and updates controls with streamed content", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
    const [text, setText] = createSignal("```ts\nconst answer = 42;\n```");
    const { host, dispose } = mount(() => <Markdown text={text()} />);
    try {
      host.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("const answer = 42;\n");
      expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Copied");
      setText("```sh\npnpm test\n```");
      expect(host.querySelectorAll("button")).toHaveLength(1);
      host.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenLastCalledWith("pnpm test\n");
      setText("Plain text");
      expect(host.querySelector("button")).toBeNull();
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("preserves numbered list starts and reports clipboard failures", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error("Denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
    const { host, dispose } = mount(() => (
      <Markdown text={"3. Third\n4. Fourth\n\n```\ncode\n```"} />
    ));
    try {
      expect(host.querySelector("ol")?.getAttribute("start")).toBe("3");
      host.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
        "Copy failed — try again",
      );
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps changed unsafe Markdown sanitized and cached remounts safe with their own controls", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
    const [text, setText] = createSignal(unsafeMarkdown("first", 1));
    const first = mount(() => <Markdown text={text()} annotationBlock='["content",0,"text"]' />);
    try {
      const firstMarkdown = first.host.querySelector<HTMLElement>(".transcript-markdown")!;
      expect(firstMarkdown.getAttribute("data-annotation-block")).toBe('["content",0,"text"]');
      expect(firstMarkdown.querySelector("script")).toBeNull();
      expect(firstMarkdown.querySelector("a")?.hasAttribute("href")).toBe(false);
      expect(firstMarkdown.querySelector("img")?.hasAttribute("onerror")).toBe(false);

      // A new unsafe source in the same mounted component is still sanitized.
      setText(unsafeMarkdown("second", 2));
      expect(firstMarkdown.querySelector("script")).toBeNull();
      expect(firstMarkdown.querySelector("h2")?.textContent).toBe("second");
      expect(firstMarkdown.querySelector("a")?.hasAttribute("onclick")).toBe(false);
      first.host.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("const second = 2;\n");

      // A cached remount of the original text stays sanitized and owns a fresh control.
      const second = mount(() => <Markdown text={unsafeMarkdown("first", 1)} />);
      try {
        const secondMarkdown = second.host.querySelector<HTMLElement>(".transcript-markdown")!;
        expect(secondMarkdown.querySelector("script")).toBeNull();
        expect(secondMarkdown.querySelector("a")?.hasAttribute("href")).toBe(false);
        expect(secondMarkdown.querySelector("img")?.hasAttribute("onerror")).toBe(false);
        expect(secondMarkdown.querySelector("h2")?.textContent).toBe("first");
        second.host.querySelector<HTMLButtonElement>("button")!.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenLastCalledWith("const first = 1;\n");
      } finally {
        second.dispose();
      }
    } finally {
      first.dispose();
      vi.unstubAllGlobals();
    }
  });
});
