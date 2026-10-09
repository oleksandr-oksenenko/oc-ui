import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ServerFileImageReader } from "../../../../../../../opencode/file-images.ts";
import { mount } from "../../../../../../../test/mount.ts";
import { Markdown } from "./Markdown.tsx";
import { ExternalLinkProvider } from "../../../../../../../ui/ExternalLinkProvider.tsx";

const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function stubObjectURL(create: (blob: Blob) => string, revoke: (url: string) => void): void {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revoke,
  });
}

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(URL, name, descriptor);
  else Reflect.deleteProperty(URL, name);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  it("updates attachment previews without rebuilding Markdown or losing selection", () => {
    const source = {
      reference: "attachment:known",
      src: "data:image/png;base64,IMAGE",
      fullSrc: "data:image/png;base64,FULL",
    };
    const [attachment, setAttachment] = createSignal<typeof source | undefined>(undefined);
    const { host, dispose } = mount(() => (
      <Markdown
        text={"Select this text ![Otter](attachment:known)"}
        resolveAttachment={() => attachment()}
      />
    ));
    const selection = window.getSelection()!;
    try {
      expect(host.textContent).toContain("Otter — image unavailable");
      setAttachment(source);
      const paragraph = host.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(paragraph.firstChild!);
      selection.removeAllRanges();
      selection.addRange(range);
      setAttachment({ ...source });
      expect(host.querySelector("p")).toBe(paragraph);
      expect(selection.toString()).toBe("Select this text ");
      host.querySelector<HTMLButtonElement>(".transcript-generated-image")!.click();
      const dialog = document.querySelector(".image-preview-content");
      setAttachment({ ...source, src: "data:image/png;base64,UPDATED" });
      expect(host.querySelector(".transcript-generated-image img")?.getAttribute("src")).toBe(
        "data:image/png;base64,UPDATED",
      );
      setAttachment({ ...source, fullSrc: "data:image/png;base64,UPDATEDFULL" });
      expect(document.querySelector(".image-preview-content")).toBe(dialog);
      expect(document.querySelector(".image-preview-image")?.getAttribute("src")).toBe(
        "data:image/png;base64,UPDATEDFULL",
      );
      setAttachment(undefined);
      expect(host.textContent).toContain("Otter — image unavailable");
      expect(document.querySelector(".image-preview-content")).toBeNull();
    } finally {
      selection.removeAllRanges();
      dispose();
    }
  });

  it("preserves linked text around nested and multiple attachment images", () => {
    const { host, dispose } = mount(() => (
      <Markdown
        text={
          "[Before **![One](attachment:one)** after ![Two](attachment:two) tail](https://example.test/notes)"
        }
        resolveAttachment={(reference) => ({ reference, src: "data:image/png;base64,IMAGE" })}
      />
    ));
    try {
      expect(host.querySelector("a button")).toBeNull();
      const links = [...host.querySelectorAll("a")];
      expect(links.map((link) => link.textContent?.trim())).toEqual(["Before", "after", "tail"]);
      expect(
        links.every((link) => link.getAttribute("href") === "https://example.test/notes"),
      ).toBe(true);
      expect(host.querySelectorAll(".transcript-generated-image")).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it("retains the correct inline preview when earlier image occurrences are removed", () => {
    const [text, setText] = createSignal(
      "![First](attachment:first)\n\n![Second](attachment:second)",
    );
    const { host, dispose } = mount(() => (
      <Markdown
        text={text()}
        resolveAttachment={(reference) => ({
          reference,
          src: `data:image/png;base64,${reference}`,
        })}
      />
    ));
    try {
      const second = host.querySelectorAll<HTMLButtonElement>(".transcript-generated-image")[1]!;
      second.click();
      const dialog = document.querySelector(".image-preview-content");
      setText("![Second](attachment:second)");
      expect(host.querySelector(".transcript-generated-image")).toBe(second);
      expect(document.querySelector(".image-preview-content")).toBe(dialog);
      expect(document.querySelector(".image-preview-image")?.getAttribute("src")).toBe(
        "data:image/png;base64,attachment:second",
      );
      document.querySelector<HTMLButtonElement>(".image-preview-close")!.click();
      setText("![Second](attachment:second)\n\n![Second](attachment:second)");
      expect(host.querySelectorAll(".transcript-generated-image")).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it("renders attachment images in place and retains an open original preview during streaming", () => {
    const [text, setText] = createSignal("Before ![Otter](attachment:ocui-image-test) after");
    const readFileImage = vi.fn<ServerFileImageReader>(async () => new Blob([]));
    const { host, dispose } = mount(() => (
      <Markdown
        text={text()}
        readFileImage={readFileImage}
        resolveAttachment={() => ({
          reference: "attachment:ocui-image-test",
          src: "data:image/jpeg;base64,PREVIEW",
          fullSrc: "data:image/png;base64,FULL",
        })}
      />
    ));
    try {
      const button = host.querySelector<HTMLButtonElement>(".transcript-generated-image")!;
      expect(button.closest("p")?.textContent).toBe("Before  after");
      expect(host.querySelector("p div")).toBeNull();
      button.click();
      const dialog = document.querySelector(".image-preview-content");
      expect(document.querySelector(".image-preview-image")?.getAttribute("src")).toBe(
        "data:image/png;base64,FULL",
      );
      setText("Before ![Otter](attachment:ocui-image-test) after, with more streamed prose.");
      expect(host.querySelector(".transcript-generated-image")).toBe(button);
      expect(document.querySelector(".image-preview-content")).toBe(dialog);
      expect(readFileImage).not.toHaveBeenCalled();
      document.querySelector<HTMLButtonElement>(".image-preview-close")!.click();
      setText("No image now");
      expect(host.querySelector(".transcript-generated-image")).toBeNull();
    } finally {
      dispose();
    }
  });

  it("shows unavailable references and avoids nesting preview buttons inside links", () => {
    const { host, dispose } = mount(() => (
      <Markdown
        text={
          "[![Otter](attachment:known)](https://example.test)\n\n![Missing](attachment:unknown)"
        }
        resolveAttachment={(reference) =>
          reference === "attachment:known"
            ? { reference, src: "data:image/png;base64,IMAGE" }
            : undefined
        }
      />
    ));
    try {
      expect(host.querySelector("a button")).toBeNull();
      expect(host.querySelector(".transcript-generated-image")).not.toBeNull();
      expect(host.textContent).toContain("Missing — image unavailable");
      expect(host.querySelector('img[src^="attachment:"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it("downloads server links for primary, keyboard-style, modifier and middle activations without opening externally", () => {
    const downloadFile = vi.fn<(href: string) => void>();
    const open = vi.fn<(url: string) => void>();
    const { host, dispose } = mount(() => (
      <ExternalLinkProvider open={open}>
        <Markdown
          text={"[Download **PNG**](/private/tmp/a.png) [web](https://example.test/a)"}
          downloadFile={downloadFile}
        />
      </ExternalLinkProvider>
    ));
    const target = host.querySelector("a strong")!;
    for (const init of [
      {},
      { detail: 0 },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
        ),
      ).toBe(false);
    }
    expect(
      target.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
      ),
    ).toBe(false);
    expect(downloadFile).toHaveBeenCalledTimes(7);
    expect(downloadFile).toHaveBeenLastCalledWith("/private/tmp/a.png");
    expect(open).not.toHaveBeenCalled();
    target.addEventListener("click", (event) => event.preventDefault(), { once: true });
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(downloadFile).toHaveBeenCalledTimes(7);
    host.querySelector<HTMLAnchorElement>('a[href="https://example.test/a"]')!.click();
    expect(open).toHaveBeenCalledWith("https://example.test/a");
    dispose();
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(downloadFile).toHaveBeenCalledTimes(7);
  });

  it("keeps file links inert without a server handler and updates handlers across rerenders", () => {
    const download = vi.fn<(href: string) => void>();
    const [handler, setHandler] = createSignal<typeof download>();
    const [text, setText] = createSignal("[file](file:///tmp/a.png)");
    const { host, dispose } = mount(() => <Markdown text={text()} downloadFile={handler()} />);
    expect(host.querySelector("a")!.getAttribute("href")).toBe("#");
    expect(
      host
        .querySelector("a")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    ).toBe(false);
    setHandler(() => download);
    setText("[file](../b.txt)");
    host.querySelector<HTMLAnchorElement>("a")!.click();
    expect(download).toHaveBeenCalledWith("../b.txt");
    dispose();
  });

  it("keeps file downloads separate from inline attachment preview activation", () => {
    const download = vi.fn<(href: string) => void>();
    const { host, dispose } = mount(() => (
      <Markdown
        text={"[Before ![Image](attachment:known) after](./output.png)"}
        downloadFile={download}
        resolveAttachment={(reference) => ({ reference, src: "data:image/png;base64,IMAGE" })}
      />
    ));
    try {
      expect(host.querySelector("a button")).toBeNull();
      host.querySelector<HTMLButtonElement>(".transcript-generated-image")!.click();
      expect(document.querySelector(".image-preview-content")).not.toBeNull();
      expect(download).not.toHaveBeenCalled();
      document.querySelector<HTMLButtonElement>(".image-preview-close")!.click();
      const links = [...host.querySelectorAll<HTMLAnchorElement>("a[data-server-file-href]")];
      expect(links.map((link) => link.textContent?.trim())).toEqual(["Before", "after"]);
      for (const link of links) link.click();
      expect(download).toHaveBeenCalledTimes(2);
      expect(download).toHaveBeenLastCalledWith("./output.png");
    } finally {
      dispose();
    }
  });
  afterEach(() => {
    restoreProperty("createObjectURL", createObjectURLDescriptor);
    restoreProperty("revokeObjectURL", revokeObjectURLDescriptor);
  });

  it("resolves file images through the server reader and revokes object URLs on disposal", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:tool-states");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);
    const readFileImage = vi.fn<ServerFileImageReader>(
      async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    );
    const { host, dispose } = mount(() => (
      <Markdown
        text={"![Tool states](file:///srv/project/tool-states.png)"}
        readFileImage={readFileImage}
      />
    ));
    try {
      const image = host.querySelector<HTMLImageElement>("img");
      expect(image?.getAttribute("alt")).toBe("Tool states");
      expect(image?.hasAttribute("src")).toBe(false);
      expect(readFileImage).toHaveBeenCalledWith("file:///srv/project/tool-states.png");
      await settle();
      expect(image?.getAttribute("src")).toBe("blob:tool-states");
    } finally {
      dispose();
    }
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tool-states");
  });

  it("revokes an object URL when its image leaves the rendered text", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:first");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);
    const readFileImage = vi.fn<ServerFileImageReader>(
      async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    );
    const [text, setText] = createSignal("![First](file:///srv/project/first.png)");
    const { host, dispose } = mount(() => <Markdown text={text()} readFileImage={readFileImage} />);
    try {
      await settle();
      expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:first");
      setText("No image here");
      await settle();
      expect(host.querySelector("img")).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    } finally {
      dispose();
    }
  });

  it("keeps a shared object URL until every reference leaves the text", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:shared");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);
    const readFileImage = vi.fn<ServerFileImageReader>(
      async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
    );
    const [text, setText] = createSignal(
      "![One](file:///srv/project/a.png)\n\n![Two](file:///srv/project/a.png)",
    );
    const { host, dispose } = mount(() => <Markdown text={text()} readFileImage={readFileImage} />);
    try {
      await settle();
      expect(host.querySelectorAll("img")).toHaveLength(2);
      expect(createObjectURL).toHaveBeenCalledTimes(1);

      setText("![One](file:///srv/project/a.png)");
      await settle();
      expect(host.querySelectorAll("img")).toHaveLength(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();

      setText("No image here");
      await settle();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:shared");
    } finally {
      dispose();
    }
  });

  it("does not publish a late resolution after the image leaves the text", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:late");
    stubObjectURL(createObjectURL, vi.fn<(url: string) => void>());
    let resolveRead: ((blob: Blob) => void) | undefined;
    const readFileImage = vi.fn<ServerFileImageReader>(
      () =>
        new Promise<Blob>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const [text, setText] = createSignal("![First](file:///srv/project/first.png)");
    const { host, dispose } = mount(() => <Markdown text={text()} readFileImage={readFileImage} />);
    try {
      setText("No image here");
      resolveRead?.(new Blob([new Uint8Array([1])], { type: "image/png" }));
      await settle();
      expect(host.querySelector("img")).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("keeps alt text without a source when the server file is unavailable", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:unused");
    stubObjectURL(createObjectURL, vi.fn<(url: string) => void>());
    const readFileImage = vi.fn<ServerFileImageReader>(async () => {
      throw new Error("not found");
    });
    const { host, dispose } = mount(() => (
      <Markdown
        text={"![Missing shot](file:///srv/project/missing.png)"}
        readFileImage={readFileImage}
      />
    ));
    try {
      await settle();
      const image = host.querySelector<HTMLImageElement>("img");
      expect(image?.getAttribute("alt")).toBe("Missing shot");
      expect(image?.hasAttribute("src")).toBe(false);
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("leaves web and data images to the browser without reading files", async () => {
    const readFileImage = vi.fn<ServerFileImageReader>(async () => new Blob([]));
    const { host, dispose } = mount(() => (
      <Markdown
        text={"![web](https://example.test/a.png)\n\n![inline](data:image/png;base64,AAAA)"}
        readFileImage={readFileImage}
      />
    ));
    try {
      const sources = [...host.querySelectorAll("img")].map((image) => image.getAttribute("src"));
      expect(sources).toEqual(["https://example.test/a.png", "data:image/png;base64,AAAA"]);
      expect(readFileImage).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

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

  it("keeps code blocks keyboard-reachable without focusing tables", () => {
    const { host, dispose } = mount(() => (
      <Markdown text={"| Check | Status |\n| --- | --- |\n| Tests | Passed |\n\n```\ncode\n```"} />
    ));
    try {
      expect(host.querySelector("pre")?.getAttribute("tabindex")).toBe("0");
      expect(host.querySelector("table")?.hasAttribute("tabindex")).toBe(false);
    } finally {
      dispose();
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
