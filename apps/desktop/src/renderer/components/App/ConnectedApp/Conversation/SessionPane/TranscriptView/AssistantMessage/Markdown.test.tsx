import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { mount } from "../../../../../../../test/mount.ts";
import { Markdown } from "./Markdown.tsx";

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
});
