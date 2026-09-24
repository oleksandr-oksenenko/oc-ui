import { describe, expect, it } from "vite-plus/test";

import { rollupSessionAttention } from "./session-attention-rollup.ts";
import type { SessionTreeNode } from "./session-tree-projection.ts";
import type { SessionAttention } from "./createSessionAttention.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";

const node = (id: string, children: readonly SessionTreeNode[] = []): SessionTreeNode => ({
  session: sessionFixture({ id, location: { directory: "/project" } }),
  children,
});

const own = (states: Record<string, SessionAttention>) => (sessionID: string) => states[sessionID];

describe("session attention rollup", () => {
  it("keeps a row's own state and origin", () => {
    const result = rollupSessionAttention([node("root")], own({ root: "permission" }));
    expect(result.get("root")).toEqual({ kind: "permission", origin: "session" });
  });

  it("rolls blocking descendant states up through every ancestor", () => {
    const tree = [node("root", [node("child", [node("grandchild")])])];
    const result = rollupSessionAttention(tree, own({ grandchild: "permission" }));
    expect(result.get("root")).toEqual({ kind: "permission", origin: "subagents" });
    expect(result.get("child")).toEqual({ kind: "permission", origin: "subagents" });
    expect(result.get("grandchild")).toEqual({ kind: "permission", origin: "session" });
  });

  it("prefers permission over question and a row's own state on ties", () => {
    const tree = [node("root", [node("child")]), node("other", [node("questioned")])];
    const result = rollupSessionAttention(
      tree,
      own({ root: "question", child: "permission", other: "question", questioned: "question" }),
    );
    expect(result.get("root")).toEqual({ kind: "permission", origin: "subagents" });
    expect(result.get("child")).toEqual({ kind: "permission", origin: "session" });
    expect(result.get("other")).toEqual({ kind: "question", origin: "session" });
    expect(result.get("questioned")).toEqual({ kind: "question", origin: "session" });
  });

  it("never rolls unread completions up and lets inherited blocking states beat them", () => {
    const tree = [node("root", [node("child")])];
    const alone = rollupSessionAttention(tree, own({ child: "completed" }));
    expect(alone.get("child")).toEqual({ kind: "completed", origin: "session" });
    expect(alone.has("root")).toBe(false);

    const mixed = rollupSessionAttention(tree, own({ root: "completed", child: "question" }));
    expect(mixed.get("root")).toEqual({ kind: "question", origin: "subagents" });
  });

  it("omits rows without any attention", () => {
    const result = rollupSessionAttention([node("root", [node("child")])], own({}));
    expect(result.size).toBe(0);
  });
});
