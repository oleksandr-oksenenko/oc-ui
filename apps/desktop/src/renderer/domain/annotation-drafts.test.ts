import { Schema } from "effect";
import { withTestWorkspace } from "../test/workspace.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  createAnnotationDraftStore,
  TranscriptAnnotationSchema,
  type TranscriptAnnotation,
} from "./annotation-drafts.ts";

const annotation = (id: string, body = "Fix this"): TranscriptAnnotation => ({
  id,
  source: {
    messageID: "message-1",
    block: "content/0/text",
    textDigest: "a".repeat(64),
    start: 2,
    end: 7,
  },
  quote: "quoted",
  body,
});

describe("createAnnotationDraftStore", () => {
  it("keeps drafts isolated and updates/removes them by ID", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    const input = annotation("ignored");
    const id = drafts.add("session-1", input);

    drafts.updateBody("session-1", id, "Updated");
    expect(drafts.get("session-1")).toEqual([{ ...input, id, body: "Updated" }]);
    expect(drafts.get("session-2")).toEqual([]);

    drafts.remove("session-1", id);
    expect(drafts.get("session-1")).toEqual([]);
  });

  it("takes drafts and restores them without overwriting newer entries", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    const first = annotation("first");
    const second = annotation("second", "Second");
    drafts.restore({ sessionID: "session-1", comments: [first, second] });
    const snapshot = drafts.take("session-1");
    const newer = drafts.add("session-1", annotation("ignored", "Newer"));

    drafts.restore(snapshot);

    expect(drafts.get("session-1").map((comment) => comment.id)).toEqual([
      "first",
      "second",
      newer,
    ]);
    expect(drafts.get("session-1").find((comment) => comment.id === newer)?.body).toBe("Newer");
  });

  it("clears only unchanged restored comments", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    const first = annotation("first");
    const second = annotation("second", "Second");
    const snapshot = { sessionID: "session-1", comments: [first, second] } as const;
    drafts.restore(snapshot);
    drafts.updateBody("session-1", "second", "Changed");

    expect(drafts.clearIfUnchanged(snapshot)).toBe(true);
    expect(drafts.get("session-1")).toEqual([{ ...second, body: "Changed" }]);
  });

  it("allows empty edits without changing the frozen submitted annotation", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    const input = annotation("ignored");
    const id = drafts.add("session-1", input);
    const snapshot = drafts.take("session-1");
    const submitted = snapshot.comments[0]!;
    expect(Object.isFrozen(submitted)).toBe(true);
    expect(Object.isFrozen(submitted.source)).toBe(true);

    drafts.restore(snapshot);
    drafts.updateBody("session-1", id, "");

    expect(submitted.body).toBe(input.body);
    expect(drafts.clearIfUnchanged(snapshot)).toBe(false);
    expect(drafts.get("session-1")[0]?.body).toBe("");
  });

  it("accepts empty drafts while keeping complete annotations strict", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    const emptyID = drafts.add("session-1", annotation("ignored", "  "));
    const empty = drafts.get("session-1").find((comment) => comment.id === emptyID);
    expect(empty).toBeDefined();
    expect(empty?.body).toBe("  ");
    expect(Schema.is(TranscriptAnnotationSchema)(empty!)).toBe(false);
  });

  it("still rejects invalid source bounds", () => {
    const drafts = withTestWorkspace((effects) => createAnnotationDraftStore(effects));
    expect(() =>
      drafts.add("session-1", {
        ...annotation("ignored"),
        source: { ...annotation("ignored").source, end: 2 },
      }),
    ).toThrow("Invalid transcript annotation");
  });
});
