import type { SessionMessageInfo } from "@opencode/client";
import { createSignal, type Accessor } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createAnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { createSessionPrompt } from "../../../../opencode/session-prompt.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createTranscriptAnnotations } from "./createTranscriptAnnotations.ts";

function setup(
  messages: Accessor<readonly SessionMessageInfo[]> = () => [],
  enabled: Accessor<boolean> = () => true,
  readAnchor: () => DOMRect = () => new DOMRect(0, 0, 100, 20),
) {
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
      messages,
      enabled,
    });
    controller.attach(host);
    return { controller, drafts, setSessionID, dispose };
  });
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("p")!);
    // JSDOM has selection ranges but no layout measurements.
    Object.assign(range, { getBoundingClientRect: readAnchor });
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  };
  return {
    ...result,
    host,
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

  it("remeasures selection and editor anchors across layout scrolls without canceling an opening", async () => {
    let finish!: (value: ArrayBuffer) => void;
    const digest = vi.fn<SubtleCrypto["digest"]>(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    let top = 100;
    const root = setup(
      () => [],
      () => true,
      () => new DOMRect(0, top, 100, 20),
    );
    try {
      root.select();
      expect(root.controller.selection()?.anchor.top).toBe(100);
      top = 60;
      root.controller.handleLayoutScroll();
      expect(root.controller.selection()?.anchor.top).toBe(60);

      const opening = root.controller.openCandidate();
      top = 30;
      root.controller.handleLayoutScroll();
      root.host.dispatchEvent(new Event("scroll"));
      expect(root.controller.selection()).toMatchObject({ pending: true, anchor: { top: 30 } });
      finish(new Uint8Array(32).buffer);
      await opening;
      const draft = root.drafts.get("first")[0]!;
      root.controller.updateBody(draft.id, "Keep this note and its editor.");
      top = 10;
      root.controller.handleLayoutScroll();
      root.host.dispatchEvent(new Event("scroll"));
      expect(root.controller.state()).toMatchObject({
        kind: "comments",
        anchor: { top: 10 },
        editingID: draft.id,
        comments: [{ annotation: { body: "Keep this note and its editor." } }],
      });

      // The layout exception must not swallow subsequent reader navigation.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      root.host.dispatchEvent(new Event("scroll"));
      expect(root.controller.state().kind).toBe("closed");
      expect(root.drafts.get("first")[0]?.body).toBe("Keep this note and its editor.");
    } finally {
      root.dispose();
    }
  });

  it.each(["draft", "sent"] as const)(
    "remeasures the %s annotation pill anchor after layout",
    (kind) => {
      const annotation = {
        source: {
          messageID: "message",
          block: "text",
          textDigest: "a".repeat(64),
          start: 0,
          end: 6,
        },
        quote: "A useful passage.",
        body: "Explain this.",
      };
      const prompt = createSessionPrompt({
        instruction: "Review the passage.",
        reviewComments: [],
        annotations: [{ ...annotation, id: "note" }],
      });
      const root = setup(() => [
        {
          id: "sent",
          type: "user",
          time: { created: 1 },
          text: prompt.text,
          metadata: prompt.metadata,
        },
      ]);
      const opener = document.createElement("button");
      document.body.append(opener);
      let top = 100;
      opener.getBoundingClientRect = () => new DOMRect(0, top, 100, 20);
      try {
        if (kind === "draft") {
          root.drafts.add("first", annotation);
          root.controller.toggleDrafts(opener);
        } else root.controller.openSent("sent", "note", opener);
        expect(root.controller.state()).toMatchObject({ kind: "comments", anchor: { top: 100 } });
        top = 60;
        root.controller.handleLayoutScroll();
        root.host.dispatchEvent(new Event("scroll"));
        expect(root.controller.state()).toMatchObject({ kind: "comments", anchor: { top: 60 } });
      } finally {
        opener.remove();
        root.dispose();
      }
    },
  );

  it.each(["resize", "scroll"])(
    "keeps typed new comments when %s dismisses the popup",
    async (event) => {
      const root = setup();
      try {
        root.select();
        await root.controller.openCandidate();
        const draft = root.drafts.get("first")[0]!;
        root.controller.updateBody(draft.id, "Keep this note.");
        if (event === "scroll")
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        window.dispatchEvent(new Event(event));
        expect(root.controller.state().kind).toBe("closed");
        expect(root.drafts.get("first")[0]?.body).toBe("Keep this note.");
      } finally {
        root.dispose();
      }
    },
  );

  it("keeps a newly opened sent annotation through a scroll delivered before the next frame", async () => {
    const prompt = createSessionPrompt({
      instruction: "Review the transcript.",
      reviewComments: [],
      annotations: [
        {
          id: "annotation-1",
          source: {
            messageID: "message",
            block: "text",
            textDigest: "a".repeat(64),
            start: 0,
            end: 6,
          },
          quote: "A useful passage.",
          body: "Explain this.",
        },
      ],
    });
    const root = setup(() => [
      {
        id: "sent-1",
        time: { created: 1 },
        type: "user",
        text: prompt.text,
        metadata: prompt.metadata,
      },
    ]);
    const quote = document.createElement("button");
    document.body.append(quote);
    try {
      root.controller.openSent("sent-1", "annotation-1", quote);
      expect(root.controller.state().kind).toBe("comments");
      // Scroll notifications queued before the popover opened arrive after it
      // appears; they must not dismiss it. A later scroll still does.
      window.dispatchEvent(new Event("scroll"));
      expect(root.controller.state().kind).toBe("comments");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      window.dispatchEvent(new Event("scroll"));
      expect(root.controller.state().kind).toBe("closed");
    } finally {
      quote.remove();
      root.dispose();
    }
  });

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

  it("closes the popup and clears the candidate when annotation availability turns off", async () => {
    const digest = vi.fn<SubtleCrypto["digest"]>(() => Promise.resolve(new Uint8Array(32).buffer));
    vi.stubGlobal("crypto", { randomUUID: crypto.randomUUID.bind(crypto), subtle: { digest } });
    const [enabled, setEnabled] = createSignal(true);
    const root = setup(() => [], enabled);
    try {
      root.select();
      expect(root.controller.selection()).toBeDefined();
      setEnabled(false);
      expect(root.controller.selection()).toBeUndefined();
      expect(root.controller.state().kind).toBe("closed");

      setEnabled(true);
      root.select();
      await root.controller.openCandidate();
      const draft = root.drafts.get("first")[0]!;
      root.controller.updateBody(draft.id, "Keep this note.");
      setEnabled(false);
      expect(root.controller.state().kind).toBe("closed");
      expect(root.drafts.get("first")[0]?.body).toBe("Keep this note.");
    } finally {
      root.dispose();
    }
  });

  it("keeps an open editor through transcript updates while its source remains", async () => {
    const root = setup();
    try {
      root.select();
      await root.controller.openCandidate();
      const draft = root.drafts.get("first")[0]!;
      root.controller.updateBody(draft.id, "Still typing.");
      // A re-render or streaming update changes the annotated block's text.
      root.host.querySelector("p")!.textContent = "A useful passage, updated.";
      await Promise.resolve();
      expect(root.controller.state().kind).toBe("comments");
      expect(root.drafts.get("first")[0]?.body).toBe("Still typing.");
    } finally {
      root.dispose();
    }
  });

  it("dismisses the popup when a transcript update removes its anchor", async () => {
    const root = setup();
    try {
      root.select();
      await root.controller.openCandidate();
      root.host.querySelector("p")!.remove();
      await Promise.resolve();
      expect(root.controller.state().kind).toBe("closed");
    } finally {
      root.dispose();
    }
  });

  it("clears the Add note candidate when a transcript update removes its block", async () => {
    const root = setup();
    try {
      root.select();
      expect(root.controller.selection()).toBeDefined();
      root.host.querySelector("p")!.remove();
      await Promise.resolve();
      expect(root.controller.selection()).toBeUndefined();
    } finally {
      root.dispose();
    }
  });

  it("keeps the popup when an unrelated pane scrolls", async () => {
    const root = setup();
    const pane = document.createElement("div");
    document.body.append(pane);
    try {
      root.select();
      await root.controller.openCandidate();
      root.controller.updateBody(root.drafts.get("first")[0]!.id, "Keep this note.");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      pane.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      expect(root.controller.state().kind).toBe("comments");
      root.host.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      expect(root.controller.state().kind).toBe("closed");
      expect(root.drafts.get("first")[0]?.body).toBe("Keep this note.");
    } finally {
      pane.remove();
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
