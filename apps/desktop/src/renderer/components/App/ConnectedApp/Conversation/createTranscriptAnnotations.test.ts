import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createAnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createTranscriptAnnotations } from "./createTranscriptAnnotations.ts";

function setup() {
  const host = document.createElement("div");
  host.innerHTML =
    '<article data-message-id="message"><p data-annotation-block="text">A useful passage.</p></article>';
  document.body.append(host);
  const result = withTestWorkspace((effects, dispose) => {
    const [sessionID, setSessionID] = createSignal("first");
    const drafts = createAnnotationDraftStore(effects);
    const controller = createTranscriptAnnotations({
      sessionID,
      drafts,
      messages: () => [],
      enabled: () => true,
    });
    controller.attach(host);
    return { controller, drafts, setSessionID, dispose };
  });
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("p")!);
    // JSDOM has selection ranges but no layout measurements.
    Object.assign(range, { getBoundingClientRect: () => new DOMRect(0, 0, 100, 20) });
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  };
  return {
    ...result,
    select,
    dispose: () => {
      result.dispose();
      host.remove();
    },
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

describe("createTranscriptAnnotations", () => {
  it("hashes only on Add and keeps DOM selection details out of the popup state", async () => {
    const digest = vi.fn<SubtleCrypto["digest"]>(() => Promise.resolve(new Uint8Array(32).buffer));
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const root = setup();
    try {
      root.select();
      expect(root.controller.selection()).toBeDefined();
      expect(digest).not.toHaveBeenCalled();
      root.controller.openCandidate();
      expect(root.controller.selection()).toBeUndefined();
      expect(root.controller.state()).toEqual({
        kind: "new",
        quote: "A useful passage.",
        anchor: expect.any(DOMRect),
      });
      expect(digest).not.toHaveBeenCalled();
      await root.controller.addCandidate("Explain this.");
      expect(digest).toHaveBeenCalledTimes(1);
      expect(root.drafts.get("first")).toHaveLength(1);
      expect(root.controller.state().kind).toBe("closed");
    } finally {
      root.dispose();
    }
  });

  it("does not add a pending annotation after switching conversations", async () => {
    let finish!: (value: ArrayBuffer) => void;
    const digest = vi.fn<SubtleCrypto["digest"]>(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const root = setup();
    try {
      root.select();
      root.controller.openCandidate();
      const adding = root.controller.addCandidate("Explain this.");
      root.setSessionID("second");
      finish(new Uint8Array(32).buffer);
      await adding;
      expect(root.drafts.get("first")).toHaveLength(0);
      expect(root.drafts.get("second")).toHaveLength(0);
      expect(root.controller.state().kind).toBe("closed");
    } finally {
      root.dispose();
    }
  });
});
