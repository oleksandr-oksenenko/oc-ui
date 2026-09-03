import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createAnnotationHighlights,
  type AnnotationHighlight,
} from "./createAnnotationHighlights.ts";

const digest = "00".repeat(32);

afterEach(() => vi.unstubAllGlobals());

describe("createAnnotationHighlights", () => {
  it("rebuilds only when source descriptors or transcript DOM change", async () => {
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

    const root = document.createElement("div");
    root.innerHTML =
      '<article data-message-id="message"><p data-annotation-block="text">hello</p></article>';
    document.body.append(root);
    const source: AnnotationHighlight = {
      key: "annotation-1",
      source: {
        messageID: "message",
        block: "text",
        textDigest: digest,
        start: 0,
        end: 5,
      },
    };

    const result = createRoot((dispose) => {
      const [sources, setSources] = createSignal<readonly AnnotationHighlight[]>([source]);
      const controller = createAnnotationHighlights({
        sources,
        canSelect: () => true,
        onSelection: () => undefined,
        onOpen: () => undefined,
        onDismiss: () => undefined,
      });
      controller.attach(root);
      return { controller, dispose, setSources };
    });

    try {
      await vi.waitFor(() => expect(registry.size).toBe(1));
      expect(digestCall).toHaveBeenCalledTimes(1);
      const initialHighlight = [...registry.values()][0];

      result.setSources([{ key: source.key, source: { ...source.source } }]);
      expect([...registry.values()][0]).toBe(initialHighlight);
      expect(digestCall).toHaveBeenCalledTimes(1);

      result.setSources([
        { key: source.key, source: { ...source.source, end: source.source.end - 1 } },
      ]);
      await vi.waitFor(() => {
        expect(digestCall).toHaveBeenCalledTimes(2);
        expect(registry.size).toBe(1);
      });

      root.querySelector<HTMLElement>("[data-annotation-block]")!.textContent = "hello!";
      await vi.waitFor(() => expect(digestCall).toHaveBeenCalledTimes(3));
    } finally {
      result.dispose();
      root.remove();
    }
  });
});
