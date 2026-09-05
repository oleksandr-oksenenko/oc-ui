import { withTestWorkspace } from "../test/workspace.ts";
import { describe, expect, it } from "vite-plus/test";

import { createSessionDraftStore } from "./drafts.ts";

describe("createSessionDraftStore", () => {
  it("keeps independent drafts for each session", () => {
    withTestWorkspace((effects, dispose) => {
      const drafts = createSessionDraftStore(effects);
      drafts.set("one", "first");
      drafts.set("two", "second");

      expect(drafts.get("one")).toBe("first");
      expect(drafts.get("two")).toBe("second");
      dispose();
    });
  });

  it("does not erase edits made while a prompt is being admitted", () => {
    withTestWorkspace((effects, dispose) => {
      const drafts = createSessionDraftStore(effects);
      drafts.set("session", "submitted text");
      drafts.set("session", "new edit");

      expect(drafts.clearIfUnchanged("session", "submitted text")).toBe(false);
      expect(drafts.get("session")).toBe("new edit");
      expect(drafts.clearIfUnchanged("session", "new edit")).toBe(true);
      expect(drafts.get("session")).toBe("");
      dispose();
    });
  });
});
