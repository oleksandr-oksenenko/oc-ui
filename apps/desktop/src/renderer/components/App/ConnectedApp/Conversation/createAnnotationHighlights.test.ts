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
) {
  return createRoot((dispose) => {
    const [current, setSources] = createSignal<readonly AnnotationHighlight[]>(sources);
    const controller = createAnnotationHighlights({
      sources: current,
      canSelect: () => true,
      onSelection: () => undefined,
      onOpen: () => undefined,
      onDismiss,
    });
    controller.attach(root);
    return { controller, dispose, setSources };
  });
}

describe("createAnnotationHighlights", () => {
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

  it("skips the rebuild for mutations outside annotated messages", async () => {
    const { digestCall, registry, registrySet } = stubHighlightRuntime();

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="message"><p data-annotation-block="text">hello</p></article>' +
      '<article data-message-id="other"><p>streaming</p></article>';
    document.body.append(root);
    const onDismiss = vi.fn<() => void>();
    const result = mountHighlights(root, [source()], onDismiss);

    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      const rebuilds = registrySet.mock.calls.length;
      const digests = digestCall.mock.calls.length;

      // Streaming in an unannotated message dismisses the popover but leaves
      // the highlight and its digest untouched.
      root.querySelector<HTMLElement>('[data-message-id="other"] p')!.textContent =
        "streaming more";
      await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
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
});
