import { createEffect, onCleanup, type Accessor } from "solid-js";

import type { TranscriptAnnotation } from "../../../../domain/annotation-drafts.ts";
import { projectAnnotationSource } from "./annotation-source.ts";

export type AnnotationSelection = {
  readonly source: Omit<TranscriptAnnotation["source"], "textDigest">;
  readonly block: HTMLElement;
  readonly text: string;
  readonly quote: string;
  readonly anchor: DOMRect;
};

export type AnnotationHighlight = {
  readonly key: string;
  readonly source: TranscriptAnnotation["source"];
};

type AnnotationHighlightsInput = {
  readonly sources: Accessor<readonly AnnotationHighlight[]>;
  readonly canSelect: () => boolean;
  readonly onSelection: (value: AnnotationSelection | undefined) => void;
  readonly onOpen: (keys: readonly string[], target: HTMLElement, anchor: DOMRect) => void;
  readonly onDismiss: () => void;
};

let instanceNumber = 0;

/** Computes the stable source hash used when restoring an annotation highlight. */
export async function digestAnnotationText(text: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Owns the transient DOM state used to select and highlight transcript annotations. */
export function createAnnotationHighlights(input: AnnotationHighlightsInput) {
  let mountedRoot: HTMLDivElement | undefined;
  let detach: (() => void) | undefined;
  let revision = 0;
  let rebuildQueued = false;
  let sourceSignature = "";
  const ranges = new Map<string, Range>();
  const highlightName = `oc-ui-transcript-annotations-${++instanceNumber}`;

  const findSource = (
    source: Pick<TranscriptAnnotation["source"], "messageID" | "block">,
  ): HTMLElement | undefined =>
    [...(mountedRoot?.querySelectorAll<HTMLElement>("[data-annotation-block]") ?? [])].find(
      (block) =>
        block.dataset.annotationBlock === source.block &&
        block.closest<HTMLElement>("[data-message-id]")?.dataset.messageId === source.messageID,
    );

  const validSelection = (value: AnnotationSelection): boolean => {
    const root = mountedRoot;
    return (
      root !== undefined &&
      root.contains(value.block) &&
      findSource(value.source) === value.block &&
      !value.block.closest('[data-annotation-disabled="true"]') &&
      projectAnnotationSource(value.block).text === value.text
    );
  };

  const captureSelection = (): void => {
    const root = mountedRoot;
    if (!root || !input.canSelect()) return;

    const native = window.getSelection();
    if (!native || native.isCollapsed || native.rangeCount !== 1) {
      // Focusing Add note collapses the browser selection while its action remains visible.
      if (!document.activeElement?.closest(".annotation-selection-action"))
        input.onSelection(undefined);
      return;
    }

    input.onSelection(readSelection(root, native));
  };

  const readSelection = (root: HTMLElement, native: Selection): AnnotationSelection | undefined => {
    const range = native.getRangeAt(0);
    const block = selectionBlock(root, range);
    if (!block) return undefined;
    const messageID = block.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const quote = native.toString();
    if (!messageID || !quote.trim()) return undefined;
    const projection = projectAnnotationSource(block);
    const start = projection.offset(range.startContainer, range.startOffset);
    const end = projection.offset(range.endContainer, range.endOffset);
    if (start === undefined || end === undefined || !projection.range(start, end)) return undefined;
    return {
      source: { messageID, block: block.dataset.annotationBlock!, start, end },
      block,
      text: projection.text,
      quote,
      anchor: range.getBoundingClientRect(),
    };
  };

  const hitTest = (event: MouseEvent): AnnotationHighlight[] =>
    input.sources().filter((item) => {
      const range = ranges.get(item.key);
      return (
        range !== undefined &&
        mountedRoot?.contains(range.startContainer) === true &&
        [...range.getClientRects()].some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        )
      );
    });

  const scheduleRebuild = (): void => {
    revision += 1;
    ranges.clear();
    globalThis.CSS?.highlights?.delete(highlightName);

    if (rebuildQueued) return;
    rebuildQueued = true;
    queueMicrotask(() => {
      rebuildQueued = false;
      void rebuild(revision);
    });
  };

  const rebuild = async (generation: number): Promise<void> => {
    const root = mountedRoot;
    const registry = globalThis.CSS?.highlights;
    const HighlightConstructor = globalThis.Highlight;
    if (!root || !registry || !HighlightConstructor) return;

    const projections = new Map<
      HTMLElement,
      {
        readonly range: (start: number, end: number) => Range | undefined;
        readonly digest: Promise<string>;
      }
    >();
    const restored = new Map<string, Range>();

    for (const item of input.sources()) {
      const block = findSource(item.source);
      if (!block || block.closest('[data-annotation-disabled="true"]')) continue;

      let entry = projections.get(block);
      if (!entry) {
        const projection = projectAnnotationSource(block);
        entry = {
          range: projection.range,
          digest: digestAnnotationText(projection.text),
        };
        projections.set(block, entry);
      }

      const textDigest = await entry.digest;
      if (
        generation !== revision ||
        mountedRoot !== root ||
        !root.isConnected ||
        !block.isConnected
      )
        return;
      if (textDigest !== item.source.textDigest) continue;

      const range = entry.range(item.source.start, item.source.end);
      if (range) restored.set(item.key, range);
    }

    if (generation !== revision || mountedRoot !== root || !root.isConnected) return;
    for (const [key, range] of restored) ranges.set(key, range);
    registry.set(highlightName, new HighlightConstructor(...restored.values()));
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      pointer = { x: event.clientX, y: event.clientY, dragged: false };
    } else {
      pointer = undefined;
    }
  };

  let pointer: { readonly x: number; readonly y: number; dragged: boolean } | undefined;
  let suppressClick = false;

  const onPointerMove = (event: PointerEvent): void => {
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3)
      pointer.dragged = true;
    const root = mountedRoot;
    if (root)
      root.style.cursor = !isControl(event.target) && hitTest(event).length ? "pointer" : "";
  };

  const onPointerUp = (): void => {
    if (!pointer) return;
    suppressClick = pointer.dragged;
    pointer = undefined;
    captureSelection();
  };

  const onClick = (event: MouseEvent): void => {
    const root = mountedRoot;
    if (
      !root ||
      event.button !== 0 ||
      isControl(event.target) ||
      !window.getSelection()?.isCollapsed
    )
      return;

    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const hits = hitTest(event);
    const range = hits[0] && ranges.get(hits[0].key);
    const block = hits[0] && findSource(hits[0].source);
    if (range && block)
      input.onOpen(
        hits.map((item) => item.key),
        block,
        range.getBoundingClientRect(),
      );
    suppressClick = false;
  };

  const onScroll = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest(".annotation-popover")) return;
    input.onDismiss();
  };

  const attach = (nextRoot: HTMLDivElement): (() => void) => {
    detach?.();
    mountedRoot = nextRoot;
    const abort = new AbortController();
    const listenerOptions = { capture: true, signal: abort.signal };
    const style = document.createElement("style");
    style.textContent = `::highlight(${highlightName}) { background-color: var(--oc-selection-ring); text-decoration: underline; text-decoration-color: var(--oc-accent); }`;
    document.head.append(style);

    const observer = new MutationObserver(() => {
      input.onDismiss();
      scheduleRebuild();
    });
    observer.observe(nextRoot, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-annotation-block",
        "data-annotation-disabled",
        "hidden",
        "aria-hidden",
      ],
    });

    nextRoot.addEventListener("pointerdown", onPointerDown, listenerOptions);
    nextRoot.addEventListener("pointermove", onPointerMove, listenerOptions);
    document.addEventListener("pointerup", onPointerUp, listenerOptions);
    nextRoot.addEventListener("click", onClick, listenerOptions);
    document.addEventListener("selectionchange", captureSelection, listenerOptions);
    window.addEventListener("scroll", onScroll, listenerOptions);
    window.addEventListener("resize", input.onDismiss, listenerOptions);

    const cleanup = (): void => {
      abort.abort();
      observer.disconnect();
      style.remove();
      nextRoot.style.cursor = "";
      if (mountedRoot !== nextRoot) return;
      ranges.clear();
      globalThis.CSS?.highlights?.delete(highlightName);
      revision += 1;
      mountedRoot = undefined;
      pointer = undefined;
      input.onDismiss();
      detach = undefined;
    };

    detach = cleanup;
    scheduleRebuild();
    return cleanup;
  };

  createEffect(() => {
    const sources = input.sources();
    const signature = JSON.stringify(
      sources.map(({ key, source }) => [
        key,
        source.messageID,
        source.block,
        source.textDigest,
        source.start,
        source.end,
      ]),
    );
    if (signature === sourceSignature) return;
    sourceSignature = signature;
    scheduleRebuild();
  });

  onCleanup(() => detach?.());

  return {
    attach,
    validSelection,
    findSource,
    root: () => mountedRoot,
  };
}

function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a,button,input,textarea,select,[contenteditable]") !== null
  );
}

function selectionBlock(root: HTMLElement, range: Range): HTMLElement | undefined {
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const block = element?.closest<HTMLElement>("[data-annotation-block]");
  return block &&
    root.contains(block) &&
    block.contains(range.endContainer) &&
    !block.closest('[data-annotation-disabled="true"]')
    ? block
    : undefined;
}
