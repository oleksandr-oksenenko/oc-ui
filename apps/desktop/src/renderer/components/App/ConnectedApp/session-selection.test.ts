import type { SessionInfo } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseSessionFallback,
  sessionAncestorIDs,
  sessionSubtreeIDs,
} from "./session-selection.ts";

const session = (id: string, parentID?: string): SessionInfo => ({
  id,
  parentID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/project" },
});

describe("session selection fallback", () => {
  it("prefers the nearest surviving ancestor, then the first ordered session", () => {
    const before = [session("root"), session("child", "root"), session("grandchild", "child")];
    const ancestors = sessionAncestorIDs("grandchild", before);

    expect(ancestors).toEqual(["child", "root"]);
    expect(chooseSessionFallback(ancestors, [before[0]!])).toBe("root");
    expect(chooseSessionFallback(ancestors, [session("other")])).toBe("other");
    expect(chooseSessionFallback(ancestors, [])).toBeUndefined();
  });

  it("collects one session and all nested descendants", () => {
    const sessions = [
      session("root"),
      session("first", "root"),
      session("grandchild", "first"),
      session("second", "root"),
      session("other"),
    ];

    expect(sessionSubtreeIDs("root", sessions)).toEqual(["root", "first", "grandchild", "second"]);
    expect(sessionSubtreeIDs("first", sessions)).toEqual(["first", "grandchild"]);
  });
});
