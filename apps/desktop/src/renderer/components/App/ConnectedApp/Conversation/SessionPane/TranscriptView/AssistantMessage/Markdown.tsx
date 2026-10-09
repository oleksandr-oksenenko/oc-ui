import { createEffect, createSignal, For, Show, onCleanup, untrack, type JSX } from "solid-js";
import { insert, Portal } from "solid-js/web";

import type { ServerFileImageReader } from "../../../../../../../opencode/file-images.ts";
import { TranscriptCodeBlock } from "./Markdown/TranscriptCodeBlock.tsx";
import { renderMarkdownCached } from "./Markdown/markdown.ts";
import { ImagePreview } from "../../../../../../../ui/ImagePreview.tsx";
import type { GeneratedImage } from "../generatedImages.ts";

export type MarkdownProps = {
  readonly annotationBlock?: string;
  readonly text: string;
  /** Resolves `file:` image sources through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
  readonly resolveAttachment?: (reference: string) => GeneratedImage | undefined;
};

/**
 * Markdown is injected as sanitized HTML. Sources for `file:` images survive
 * sanitization as `data-file-src` (never as `src`), so they are resolved here
 * through the connected server's file contract and swapped to an object URL.
 * The alt text stays visible until the bytes arrive, and the reader's owner
 * aborts outstanding work when the workspace closes.
 */
export function Markdown(props: MarkdownProps): JSX.Element {
  let root!: HTMLDivElement;
  const [blocks, setBlocks] = createSignal<
    { host: HTMLDivElement; text: string; language: string }[]
  >([]);
  const objectUrls = new Map<string, string>();
  const [images, setImages] = createSignal<
    { host: HTMLSpanElement; reference: string; alt: string }[]
  >([]);
  let activeReader: ServerFileImageReader | undefined;
  let generation = 0;

  const revokeObjectUrls = (): void => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  };

  onCleanup(() => {
    generation += 1;
    activeReader = undefined;
    revokeObjectUrls();
  });

  createEffect(() => {
    const readFileImage = props.readFileImage;
    if (readFileImage !== activeReader) {
      // A replaced reader may resolve the same URL from another location.
      activeReader = readFileImage;
      revokeObjectUrls();
    }
    const currentGeneration = ++generation;
    const focused = root.contains(document.activeElement) ? document.activeElement : undefined;
    const rendered = document.createElement("div");
    rendered.innerHTML = renderMarkdownCached(props.text);
    const previousImages = [...untrack(images)];
    setImages(
      [...rendered.querySelectorAll<HTMLImageElement>("img[data-attachment-src]")].map((image) => {
        const reference = image.getAttribute("data-attachment-src")!;
        const alt = image.alt || "Generated image";
        const index = previousImages.findIndex(
          (existing) => existing.reference === reference && existing.alt === alt,
        );
        const item =
          index >= 0
            ? previousImages.splice(index, 1)[0]!
            : {
                host: document.createElement("span"),
                reference,
                alt,
              };
        // The preview owns activation; do not nest its button inside a Markdown link.
        const anchor = image.closest("a");
        if (anchor) {
          const range = document.createRange();
          range.selectNodeContents(anchor);
          range.setStartAfter(image);
          const after = document.createElement("a");
          for (const attribute of anchor.attributes)
            after.setAttribute(attribute.name, attribute.value);
          after.append(range.extractContents());
          anchor.after(image, after);
          for (const link of [anchor, after]) {
            if (!link.textContent?.trim() && !link.querySelector("img"))
              link.replaceWith(...link.childNodes);
          }
        }
        image.replaceWith(item.host);
        return item;
      }),
    );
    const renderedFileUrls = new Set<string>();
    for (const image of rendered.querySelectorAll<HTMLImageElement>("img[data-file-src]")) {
      const fileUrl = image.getAttribute("data-file-src");
      if (fileUrl === null || readFileImage === undefined) continue;
      renderedFileUrls.add(fileUrl);
      const cached = objectUrls.get(fileUrl);
      if (cached !== undefined) {
        image.src = cached;
        continue;
      }
      void readFileImage(fileUrl).then(
        (blob) => {
          // A newer render already replaced this element.
          if (currentGeneration !== generation) return undefined;
          let url = objectUrls.get(fileUrl);
          if (url === undefined) {
            url = URL.createObjectURL(blob);
            objectUrls.set(fileUrl, url);
          }
          image.src = url;
          return undefined;
        },
        () => undefined,
      );
    }
    // Images that left the rendered text must not keep their bytes alive.
    for (const [fileUrl, url] of objectUrls) {
      if (renderedFileUrls.has(fileUrl)) continue;
      URL.revokeObjectURL(url);
      objectUrls.delete(fileUrl);
    }
    const previous = untrack(blocks);
    setBlocks(
      [...rendered.querySelectorAll("pre")].map((pre, index) => {
        const text = pre.textContent ?? "";
        const language = pre.querySelector("code")?.getAttribute("data-code-language") ?? "";
        const existing = previous[index];
        if (existing?.text === text && existing.language === language) {
          pre.replaceWith(existing.host);
          return existing;
        }
        const host = document.createElement("div");
        host.className = "transcript-code-block";
        pre.replaceWith(host);
        return {
          host,
          text,
          language,
        };
      }),
    );
    root.replaceChildren(...rendered.childNodes);
    if (focused instanceof HTMLElement && root.contains(focused))
      focused.focus({ preventScroll: true });
  });

  return (
    <>
      <div
        ref={(element) => {
          root = element;
        }}
        data-annotation-block={props.annotationBlock}
        class="transcript-markdown"
      />
      <For each={blocks()}>
        {(block) => (
          <Portal mount={block.host}>
            <TranscriptCodeBlock code={block.text} language={block.language} />
          </Portal>
        )}
      </For>
      <For each={images()}>
        {(image) => {
          const attachment = () => props.resolveAttachment?.(image.reference);
          // Portal adds a div wrapper; insert directly so paragraph/table images
          // remain phrasing content. For owns the controls and dialog cleanup.
          insert(image.host, () => (
            <Show when={attachment()?.src} fallback={<span>{image.alt} — image unavailable</span>}>
              {(src) => (
                <ImagePreview
                  src={src()}
                  fullSrc={attachment()?.fullSrc}
                  alt={image.alt}
                  class="transcript-generated-image"
                />
              )}
            </Show>
          ));
          onCleanup(() => image.host.replaceChildren());
          return null;
        }}
      </For>
    </>
  );
}
