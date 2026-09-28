import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createAnnotationHighlights,
  type AnnotationHighlight,
} from "./createAnnotationHighlights.ts";

const digest = "00".repeat(32);

afterEach(() => vi.unstubAllGlobals());

function stubHighlightRuntime() {
  const digestCall = vi.fn<() => Promise<ArrayBuffer>>(async () => new Uint8Array(32).buffer);
  vi.stubGlobal("crypto", { subtle: { digest: digestCall } });
  const registry = new Map<string, unknown>();
  vi.stubGlobal("CSS", { highlights: registry });
  class MockHighlight {
    readonly ranges: readonly Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  vi.stubGlobal("Highlight", MockHighlight);
  return { digestCall, registry, registrySet: vi.spyOn(registry, "set") };
}

const source = (overrides: Partial<AnnotationHighlight["source"]> = {}): AnnotationHighlight => ({
  key: "annotation-1",
  source: {
    messageID: "message",
    block: "text",
    textDigest: digest,
    start: 0,
    end: 5,
    ...overrides,
  },
});

function mountHighlights(
  root: HTMLDivElement,
  sources: readonly AnnotationHighlight[],
  onDismiss: () => void = () => undefined,
  onMutation: () => void = () => undefined,
  anchor: () => HTMLElement | undefined = () => undefined,
) {
  return createRoot((dispose) => {
    const [current, setSources] = createSignal<readonly AnnotationHighlight[]>(sources);
    const controller = createAnnotationHighlights({
      sources: current,
      canSelect: () => true,
      onSelection: () => undefined,
      onOpen: () => undefined,
      onDismiss,
      onMutation,
      anchor,
    });
    controller.attach(root);
    return { controller, dispose, setSources };
  });
}

/** jsdom has no Range geometry; the hit test only iterates rects and anchors. */
function stubRangeRects(readRect: () => DOMRect = () => new DOMRect(0, 0, 100, 100)) {
  const restores: Array<() => void> = [];
  const define = (
    name: "getClientRects" | "getBoundingClientRect",
    value: (() => DOMRectList) | (() => DOMRect),
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, name);
    Object.defineProperty(Range.prototype, name, { value, configurable: true, writable: true });
    restores.push(() => {
      if (descriptor !== undefined) {
        Object.defineProperty(Range.prototype, name, descriptor);
        return;
      }
      Reflect.deleteProperty(Range.prototype, name);
    });
  };
  const rects = vi.fn<() => DOMRectList>(() => {
    const current = readRect();
    return Object.assign([current], {
      item: (index: number) => (index === 0 ? current : null),
    });
  });
  define("getClientRects", rects);
  define("getBoundingClientRect", readRect);
  return {
    rects,
    restore: () => {
      for (const restore of restores.toReversed()) restore();
    },
  };
}

function clickAt(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
}

describe("createAnnotationHighlights", () => {
  it("scrolls the restored text range within its transcript scroller and rejects a missing source", async () => {
    const { registry } = stubHighlightRuntime();
    const geometry = stubRangeRects(() => new DOMRect(20, 500, 90, 20));
    const root = document.createElement("div");
    root.innerHTML =
      '<div style="overflow-y: auto"><article data-message-id="message"><p data-annotation-block="text">hello world</p></article></div>';
    document.body.append(root);
    const scroller = root.querySelector<HTMLElement>("div");
    if (!scroller) throw new Error("Missing transcript scroller");
    Object.defineProperties(scroller, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 900 },
    });
    scroller.getBoundingClientRect = () => new DOMRect(0, 100, 300, 200);
    const scrollBy = vi.fn<(options?: ScrollToOptions | number) => void>();
    scroller.scrollBy = (optionsOrX?: ScrollToOptions | number) => scrollBy(optionsOrX);
    const result = mountHighlights(root, [source()]);
    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      expect(result.controller.jumpTo("annotation-1")).toBe(root.querySelector("p"));
      expect(scrollBy).toHaveBeenCalledWith({ top: 310, left: 0, behavior: "instant" });
      root.querySelector("p")!.remove();
      expect(result.controller.jumpTo("annotation-1")).toBeUndefined();
    } finally {
      result.dispose();
      root.remove();
      geometry.restore();
    }
  });
  it.each([
    [
      "source itself",
      '<pre id="inner" data-annotation-block="text" style="overflow-x: auto; overflow-y: auto">hello world</pre>',
    ],
    [
      "nested code block",
      '<div data-annotation-block="text"><pre id="inner" style="overflow-x: auto; overflow-y: auto">hello world</pre></div>',
    ],
  ])(
    "reveals a range inside a scrollable %s before the outer transcript",
    async (_label, markup) => {
      const { registry } = stubHighlightRuntime();
      let innerTop = 0;
      let innerLeft = 0;
      let outerTop = 0;
      const geometry = stubRangeRects(
        () => new DOMRect(150 - innerLeft, 700 - innerTop - outerTop, 50, 20),
      );
      const root = document.createElement("div");
      root.innerHTML = `<div id="outer" style="overflow-y: auto"><article data-message-id="message">${markup}</article></div>`;
      document.body.append(root);
      const inner = root.querySelector<HTMLElement>("#inner")!;
      const outer = root.querySelector<HTMLElement>("#outer")!;
      Object.defineProperties(inner, {
        clientHeight: { value: 200 },
        scrollHeight: { value: 800 },
        clientWidth: { value: 100 },
        scrollWidth: { value: 500 },
      });
      Object.defineProperties(outer, {
        clientHeight: { value: 250 },
        scrollHeight: { value: 900 },
        clientWidth: { value: 300 },
        scrollWidth: { value: 300 },
      });
      inner.getBoundingClientRect = () => new DOMRect(0, 400 - outerTop, 100, 200);
      outer.getBoundingClientRect = () => new DOMRect(0, 100, 300, 250);
      const order: string[] = [];
      const innerScroll = vi.fn<(options: ScrollToOptions) => void>((options) => {
        order.push("inner");
        innerTop += options.top ?? 0;
        innerLeft += options.left ?? 0;
      });
      const outerScroll = vi.fn<(options: ScrollToOptions) => void>((options) => {
        order.push("outer");
        outerTop += options.top ?? 0;
      });
      Object.defineProperty(inner, "scrollBy", { value: innerScroll });
      Object.defineProperty(outer, "scrollBy", { value: outerScroll });
      const result = mountHighlights(root, [source()]);
      try {
        await vi.waitFor(() => expect(registry.size).toBe(1));
        expect(result.controller.jumpTo("annotation-1")).toBe(
          root.querySelector("[data-annotation-block]"),
        );
        expect(order).toEqual(["inner", "outer"]);
        expect(innerScroll).toHaveBeenCalledWith({ top: 210, left: 125, behavior: "instant" });
        expect(outerScroll).toHaveBeenCalledWith({ top: 275, left: 0, behavior: "instant" });
      } finally {
        result.dispose();
        root.remove();
        geometry.restore();
      }
    },
  );
  it("rebuilds only when source descriptors or transcript DOM change", async () => {
    const { digestCall, registry, registrySet } = stubHighlightRuntime();

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="message"><p data-annotation-block="text">hello</p></article>';
    document.body.append(root);
    const result = mountHighlights(root, [source()]);

    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      expect(digestCall).toHaveBeenCalledTimes(1);
      const initialHighlight = [...registry.values()][0];

      result.setSources([source()]);
      expect([...registry.values()][0]).toBe(initialHighlight);
      expect(registrySet).toHaveBeenCalledTimes(1);
      expect(digestCall).toHaveBeenCalledTimes(1);

      // A new range rebuilds, but the unchanged block text reuses its digest.
      result.setSources([source({ end: 4 })]);
      await vi.waitFor(() => expect(registrySet).toHaveBeenCalledTimes(2));
      expect(digestCall).toHaveBeenCalledTimes(1);
      expect(registry.size).toBe(1);

      // Changed text hashes again and drops the digest match.
      root.querySelector<HTMLElement>("[data-annotation-block]")!.textContent = "hello!";
      await vi.waitFor(() => expect(digestCall).toHaveBeenCalledTimes(2));
      expect(registrySet).toHaveBeenCalledTimes(3);
    } finally {
      result.dispose();
      root.remove();
    }
  });

  it("notifies mutations without dismissing or rebuilding outside annotated messages", async () => {
    const { digestCall, registry, registrySet } = stubHighlightRuntime();

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="message"><p data-annotation-block="text">hello</p></article>' +
      '<article data-message-id="other"><p>streaming</p></article>';
    document.body.append(root);
    const onDismiss = vi.fn<() => void>();
    const onMutation = vi.fn<() => void>();
    const result = mountHighlights(root, [source()], onDismiss, onMutation);

    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      const rebuilds = registrySet.mock.calls.length;
      const digests = digestCall.mock.calls.length;

      // Streaming in an unannotated message leaves the highlight and its digest
      // untouched. The controller, not this observer, decides whether the
      // mutation invalidates an open popup.
      root.querySelector<HTMLElement>('[data-message-id="other"] p')!.textContent =
        "streaming more";
      await vi.waitFor(() => expect(onMutation).toHaveBeenCalled());
      expect(onDismiss).not.toHaveBeenCalled();
      expect(registrySet).toHaveBeenCalledTimes(rebuilds);
      expect(digestCall).toHaveBeenCalledTimes(digests);
      expect(registry.size).toBe(1);

      // A change inside the annotated message rebuilds again.
      root.querySelector<HTMLElement>('[data-message-id="message"] p')!.textContent = "hello!";
      await vi.waitFor(() => expect(registrySet.mock.calls.length).toBe(rebuilds + 1));
      expect(digestCall).toHaveBeenCalledTimes(digests + 1);
    } finally {
      result.dispose();
      root.remove();
    }
  });

  it("dismisses only for scrolls that can move the anchor", async () => {
    const { registry } = stubHighlightRuntime();

    const pane = document.createElement("div");
    const outer = document.createElement("div");
    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="message"><p data-annotation-block="text">hello</p></article>';
    outer.append(root);
    document.body.append(pane, outer);
    const anchor = root.querySelector<HTMLElement>("p")!;
    const onDismiss = vi.fn<() => void>();
    const result = mountHighlights(
      root,
      [source()],
      onDismiss,
      () => undefined,
      () => anchor,
    );

    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));

      // Scrolling an unrelated pane leaves the popup in place.
      pane.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      expect(onDismiss).not.toHaveBeenCalled();

      // The anchored element's own scroller, the transcript's ancestors and
      // the window can all move the anchor and dismiss.
      anchor.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
      outer.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
      window.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(3));
    } finally {
      result.dispose();
      root.remove();
      outer.remove();
      pane.remove();
    }
  });

  it("hit-tests only annotations in the block under the pointer", async () => {
    const { registry } = stubHighlightRuntime();
    const { rects, restore } = stubRangeRects();

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="one"><p data-annotation-block="a">alpha</p><span>plain</span></article>' +
      '<article data-message-id="two"><p data-annotation-block="b">beta</p></article>' +
      '<article data-message-id="three"><p data-annotation-block="c">gamma</p></article>';
    document.body.append(root);
    const onOpen = vi.fn<(keys: readonly string[], target: HTMLElement, anchor: DOMRect) => void>();
    const result = createRoot((dispose) => {
      const [sources] = createSignal<readonly AnnotationHighlight[]>([
        {
          key: "one",
          source: { messageID: "one", block: "a", textDigest: digest, start: 0, end: 5 },
        },
        {
          key: "two",
          source: { messageID: "two", block: "b", textDigest: digest, start: 0, end: 4 },
        },
      ]);
      const controller = createAnnotationHighlights({
        sources,
        canSelect: () => true,
        onSelection: () => undefined,
        onOpen,
        onDismiss: () => undefined,
      });
      controller.attach(root);
      return { dispose };
    });
    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));

      const click = clickAt;

      // A block without annotations performs no geometry queries.
      click(root.querySelector('[data-message-id="one"] span')!);
      expect(rects).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();

      // A marked block with no matching source is rejected the same way, on
      // click and on the pointer-move cursor path.
      click(root.querySelector('[data-message-id="three"] p')!);
      root
        .querySelector('[data-message-id="three"] p')!
        .dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }));
      expect(rects).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();

      // Only the annotation in the clicked block is measured and opened.
      click(root.querySelector('[data-message-id="two"] p')!);
      expect(rects).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen.mock.calls[0]?.[0]).toEqual(["two"]);
    } finally {
      result.dispose();
      restore();
      root.remove();
    }
  });

  it("opens overlapping annotations in the same block", async () => {
    const { registry } = stubHighlightRuntime();
    const { restore } = stubRangeRects();

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="one"><p data-annotation-block="a">alpha</p></article>';
    document.body.append(root);
    const onOpen = vi.fn<(keys: readonly string[], target: HTMLElement, anchor: DOMRect) => void>();
    const result = createRoot((dispose) => {
      const [sources] = createSignal<readonly AnnotationHighlight[]>([
        {
          key: "first",
          source: { messageID: "one", block: "a", textDigest: digest, start: 0, end: 5 },
        },
        {
          key: "second",
          source: { messageID: "one", block: "a", textDigest: digest, start: 1, end: 4 },
        },
      ]);
      const controller = createAnnotationHighlights({
        sources,
        canSelect: () => true,
        onSelection: () => undefined,
        onOpen,
        onDismiss: () => undefined,
      });
      controller.attach(root);
      return { dispose };
    });
    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      root
        .querySelector('[data-message-id="one"] p')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen.mock.calls[0]?.[0]).toEqual(["first", "second"]);
    } finally {
      result.dispose();
      restore();
      root.remove();
    }
  });
});
