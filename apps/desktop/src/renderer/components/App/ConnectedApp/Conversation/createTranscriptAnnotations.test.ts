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
  it("prepares the source once and opens an ordinary draft already editing", async () => {
    const digest = vi.fn<SubtleCrypto["digest"]>(() => Promise.resolve(new Uint8Array(32).buffer));
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const root = setup();
    try {
      root.select();
      expect(digest).not.toHaveBeenCalled();
      await root.controller.openCandidate();
      const draft = root.drafts.get("first")[0]!;
      expect(digest).toHaveBeenCalledTimes(1);
      expect(draft.body).toBe("");
      expect(root.controller.selection()).toBeUndefined();
      expect(root.controller.state()).toEqual({
        kind: "comments",
        anchor: expect.any(DOMRect),
        editingID: draft.id,
        comments: [{ key: draft.id, annotation: draft, readonly: false }],
      });
      root.controller.updateBody(draft.id, "Explain this.");
      root.controller.finishEditing(draft.id);
      root.controller.edit(draft.id);
      root.controller.updateBody(draft.id, "Explain this clearly.");
      root.controller.close();
      expect(root.drafts.get("first")[0]?.body).toBe("Explain this clearly.");
      expect(digest).toHaveBeenCalledTimes(1);
    } finally {
      root.dispose();
    }
  });

  it.each(["resize", "scroll"])(
    "keeps typed new comments when %s dismisses the popup",
    async (event) => {
      const root = setup();
      try {
        root.select();
        await root.controller.openCandidate();
        const draft = root.drafts.get("first")[0]!;
        root.controller.updateBody(draft.id, "Keep this note.");
        window.dispatchEvent(new Event(event));
        expect(root.controller.state().kind).toBe("closed");
        expect(root.drafts.get("first")[0]?.body).toBe("Keep this note.");
      } finally {
        root.dispose();
      }
    },
  );

  it("removes empty drafts when editing finishes or the popup closes", async () => {
    const root = setup();
    try {
      root.select();
      await root.controller.openCandidate();
      root.controller.finishEditing(root.drafts.get("first")[0]!.id);
      expect(root.drafts.get("first")).toHaveLength(0);
      expect(root.controller.state().kind).toBe("closed");
      root.select();
      await root.controller.openCandidate();
      root.controller.close();
      expect(root.drafts.get("first")).toHaveLength(0);
    } finally {
      root.dispose();
    }
  });

  it("does not open a pending annotation after switching conversations", async () => {
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
      const opening = root.controller.openCandidate();
      expect(root.controller.selection()?.pending).toBe(true);
      await root.controller.openCandidate();
      expect(digest).toHaveBeenCalledTimes(1);
      root.setSessionID("second");
      finish(new Uint8Array(32).buffer);
      await opening;
      expect(root.drafts.get("first")).toHaveLength(0);
      expect(root.drafts.get("second")).toHaveLength(0);
      expect(root.controller.state().kind).toBe("closed");
    } finally {
      root.dispose();
    }
  });

  it("does not let a canceled opening replace or block a later annotation", async () => {
    const finishes: ((value: ArrayBuffer) => void)[] = [];
    const digest = vi.fn<SubtleCrypto["digest"]>(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishes.push(resolve);
        }),
    );
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const root = setup();
    try {
      root.select();
      const first = root.controller.openCandidate();
      window.dispatchEvent(new Event("resize"));
      root.select();
      const second = root.controller.openCandidate();
      finishes[1]!(new Uint8Array(32).buffer);
      await second;
      const state = root.controller.state();
      finishes[0]!(new Uint8Array(32).buffer);
      await first;
      expect(root.controller.state()).toBe(state);
      expect(root.drafts.get("first")).toHaveLength(1);
    } finally {
      root.dispose();
    }
  });

  it("allows retry after source preparation fails", async () => {
    const digest = vi
      .fn<SubtleCrypto["digest"]>()
      .mockRejectedValueOnce(new Error("Digest failed"))
      .mockResolvedValue(new Uint8Array(32).buffer);
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const root = setup();
    try {
      root.select();
      await root.controller.openCandidate();
      expect(root.controller.selection()).toMatchObject({
        pending: false,
        error: expect.any(String),
      });
      expect(root.drafts.get("first")).toHaveLength(0);
      await root.controller.openCandidate();
      expect(root.controller.selection()).toBeUndefined();
      expect(root.drafts.get("first")).toHaveLength(1);
    } finally {
      root.dispose();
    }
  });
});
