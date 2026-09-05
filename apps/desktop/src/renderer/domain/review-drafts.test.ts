import { withTestWorkspace } from "../test/workspace.ts";
import { describe, expect, it } from "vite-plus/test";

import { createReviewDraftStore, type ReviewDraftKey } from "./review-drafts.ts";

const key: ReviewDraftKey = { sessionID: "session-1", comparison: "working" };
const selection = { start: 3, side: "additions" as const, end: 4 };

describe("createReviewDraftStore", () => {
  it("isolates drafts by session and comparison", () => {
    const drafts = withTestWorkspace((effects) => createReviewDraftStore(effects));
    const branch = { ...key, comparison: "branch" as const };
    const id = drafts.begin(key, "src/a.ts", selection, "const a = 1;\n");
    drafts.updateBody(key, id, "Use a named constant");
    drafts.begin(branch, "src/a.ts", selection, "const b = 2;\n");

    expect(drafts.get(key).comments).toHaveLength(1);
    expect(drafts.get(key).comments[0]).toMatchObject({ id, body: "Use a named constant" });
    expect(drafts.get(branch).comments).toHaveLength(1);
    expect(drafts.get({ ...key, sessionID: "session-2" }).comments).toHaveLength(0);
  });

  it("drops an empty prior draft and makes the new comment the sole editor", () => {
    const drafts = withTestWorkspace((effects) => createReviewDraftStore(effects));
    const emptyID = drafts.begin(key, "empty.ts", selection, "empty");
    const savedID = drafts.begin(key, "saved.ts", selection, "saved");
    drafts.updateBody(key, savedID, "Keep this comment");
    const nextID = drafts.begin(key, "next.ts", selection, "next");

    expect(nextID).not.toBe(emptyID);
    expect(drafts.get(key)).toEqual({
      comments: [
        expect.objectContaining({ id: savedID, body: "Keep this comment" }),
        expect.objectContaining({ id: nextID, body: "" }),
      ],
      editingCommentID: nextID,
    });
  });

  it("captures only nonempty comments and clears only an unchanged revision", () => {
    const drafts = withTestWorkspace((effects) => createReviewDraftStore(effects));
    const emptyID = drafts.begin(key, "empty.ts", selection, "empty");
    const submittedID = drafts.begin(key, "submitted.ts", selection, "submitted");
    drafts.updateBody(key, emptyID, "  \n");
    drafts.updateBody(key, submittedID, "Fix this");
    const snapshot = drafts.capture(key);

    expect(snapshot.comments).toHaveLength(1);
    expect(snapshot.comments[0]).toMatchObject({ id: submittedID, body: "Fix this" });
    drafts.updateBody(key, submittedID, "Changed while sending");
    expect(drafts.clearIfUnchanged(snapshot)).toBe(false);
    expect(drafts.get(key).comments).toHaveLength(1);

    const current = drafts.capture(key);
    expect(drafts.clearIfUnchanged(current)).toBe(true);
    expect(drafts.get(key).comments).toHaveLength(0);
  });

  it("supports editing and removal without changing the content for edit", () => {
    const drafts = withTestWorkspace((effects) => createReviewDraftStore(effects));
    const id = drafts.begin(key, "a.ts", selection, "code");
    const snapshot = drafts.capture(key);
    drafts.edit(key);
    expect(drafts.get(key).editingCommentID).toBeUndefined();
    drafts.edit(key, id);
    expect(drafts.get(key).editingCommentID).toBe(id);
    expect(drafts.capture(key).revision).toBe(snapshot.revision);
    drafts.remove(key, id);
    expect(drafts.get(key).comments).toHaveLength(0);
  });
});
