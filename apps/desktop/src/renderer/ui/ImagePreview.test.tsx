import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createSignal } from "solid-js";

import { mount } from "../test/mount.ts";
import { ImagePreview, isImageFile, promptFileImageSource } from "./ImagePreview.tsx";

const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(URL, name, descriptor);
  else Reflect.deleteProperty(URL, name);
}

function stubObjectURL(create: (file: File) => string, revoke: (url: string) => void): void {
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

describe("ImagePreview", () => {
  afterEach(() => {
    restoreProperty("createObjectURL", createObjectURLDescriptor);
    restoreProperty("revokeObjectURL", revokeObjectURLDescriptor);
  });

  it("detects local image files and builds stored message sources", () => {
    expect(isImageFile(new File([], "photo.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([], "photo.png"))).toBe(true);
    expect(isImageFile(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);

    const inline = {
      data: "AAAA",
      mime: "image/png",
      source: { type: "inline" },
      name: "photo.png",
    } as const;
    expect(promptFileImageSource(inline)).toBe("data:image/png;base64,AAAA");
    // A remote attachment keeps usable bytes even when the source points at a
    // server path the renderer cannot load.
    expect(
      promptFileImageSource({
        ...inline,
        source: { type: "uri", uri: "file:///srv/workspace/photo.png" },
      }),
    ).toBe("data:image/png;base64,AAAA");
    expect(
      promptFileImageSource({
        data: "AAAA",
        mime: "text/plain",
        source: { type: "inline" },
        name: "notes.txt",
      }),
    ).toBeUndefined();
  });

  it("enlarges a thumbnail, moves focus into the dialog, and restores it when closed", async () => {
    const mounted = mount(() => <ImagePreview src="data:image/png;base64,AAAA" alt="photo.png" />);
    const thumbnail = mounted.host.querySelector<HTMLButtonElement>(".image-preview-thumbnail");
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.getAttribute("aria-label")).toBe("Enlarge photo.png");
    expect(thumbnail?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");

    thumbnail?.focus();
    thumbnail?.click();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Preview of photo.png");
    expect(dialog?.querySelector(".image-preview-image")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog?.contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(thumbnail);
    mounted.dispose();
  });

  it("dismisses on a backdrop click but keeps the image click", async () => {
    const mounted = mount(() => <ImagePreview src="data:image/png;base64,AAAA" alt="photo.png" />);
    const thumbnail = mounted.host.querySelector<HTMLButtonElement>(".image-preview-thumbnail");
    if (!thumbnail) throw new Error("Thumbnail did not render");
    thumbnail.focus();

    thumbnail.click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error("Preview did not open");
    await new Promise((resolve) => setTimeout(resolve, 0));

    dialog.querySelector<HTMLElement>(".image-preview-image")?.click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    dialog.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(thumbnail);
    mounted.dispose();
  });

  it("creates and revokes an object URL for an attached file", () => {
    const createObjectURL = vi.fn<(file: File) => string>(() => "blob:preview");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);

    const mounted = mount(() => (
      <ImagePreview file={new File([], "photo.png", { type: "image/png" })} alt="photo.png" />
    ));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(mounted.host.querySelector("img")?.getAttribute("src")).toBe("blob:preview");

    mounted.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("revokes the previous object URL when the attached file changes", () => {
    const createObjectURL = vi.fn<(file: File) => string>((file) => `blob:${file.name}`);
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);

    const [file, setFile] = createSignal(new File([], "first.png", { type: "image/png" }));
    const mounted = mount(() => <ImagePreview file={file()} alt="photo.png" />);
    expect(mounted.host.querySelector("img")?.getAttribute("src")).toBe("blob:first.png");

    setFile(new File([], "second.png", { type: "image/png" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first.png");
    expect(mounted.host.querySelector("img")?.getAttribute("src")).toBe("blob:second.png");

    mounted.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second.png");
  });
});
