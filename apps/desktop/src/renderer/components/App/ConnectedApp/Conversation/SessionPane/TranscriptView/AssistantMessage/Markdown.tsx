import { createEffect, createSignal, For, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

import type { ServerFileImageReader } from "../../../../../../../opencode/file-images.ts";
import { CopyCode } from "./Markdown/CopyCode.tsx";
import { renderMarkdownCached } from "./Markdown/markdown.ts";

export type MarkdownProps = {
  readonly annotationBlock?: string;
  readonly text: string;
  /** Resolves `file:` image sources through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
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
  const [blocks, setBlocks] = createSignal<{ host: HTMLDivElement; text: string }[]>([]);
  const objectUrls = new Map<string, string>();
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
    root.innerHTML = renderMarkdownCached(props.text);
    // Only scrollable regions take a tab stop; tables wrap instead of scrolling.
    for (const codeBlock of root.querySelectorAll<HTMLElement>("pre")) {
      codeBlock.tabIndex = 0;
    }
    const renderedFileUrls = new Set<string>();
    for (const image of root.querySelectorAll<HTMLImageElement>("img[data-file-src]")) {
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
    setBlocks(
      [...root.querySelectorAll("pre")].map((pre) => {
        const host = document.createElement("div");
        host.className = "transcript-code-block";
        pre.replaceWith(host);
        host.append(pre);
        return { host, text: pre.textContent ?? "" };
      }),
    );
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
            <CopyCode text={block.text} />
          </Portal>
        )}
      </For>
    </>
  );
}
