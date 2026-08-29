import type { SessionInfo } from "@opencode-ai/client";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { projectSessionTree } from "./session-tree-projection.ts";

const day = 24 * 60 * 60 * 1000;
const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-26T15:30:00Z"));

function session(
  id: string,
  title: string | undefined,
  parentID: string | undefined,
  updated: number,
  created = now - 30 * day,
): SessionInfo {
  return {
    id,
    title,
    parentID,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, updated },
    location: { directory: "/project" },
  };
}

const ids = (nodes: readonly { session: SessionInfo }[]) => nodes.map((node) => node.session.id);

describe("projectSessionTree", () => {
  it("builds hierarchy with orphans and preserves root and sibling order", () => {
    const projection = projectSessionTree(
      [
        session("root-a", "A", undefined, now),
        session("child-1", "1", "root-a", now),
        session("orphan", "O", "missing", now),
        session("child-2", "2", "root-a", now),
        session("root-b", "B", undefined, now),
      ],
      "",
      now,
    );
    expect(ids(projection.roots)).toEqual(["root-a", "orphan", "root-b"]);
    expect(ids(projection.roots[0]?.children ?? [])).toEqual(["child-1", "child-2"]);
  });

  it("filters recursively, retaining matching ancestors and pruning unrelated branches", () => {
    const projection = projectSessionTree(
      [
        session("root", "Project", undefined, now),
        session("parent", "Notes", "root", now),
        session("match", "Deep MATCH", "parent", now),
        session("unrelated", "Personal", undefined, now),
        session("leaf", "Other", "unrelated", now),
      ],
      " match ",
      now,
    );
    expect(ids(projection.roots)).toEqual(["root"]);
    expect(ids(projection.roots[0]?.children ?? [])).toEqual(["parent"]);
    expect(ids(projection.roots[0]?.children[0]?.children ?? [])).toEqual(["match"]);
  });

  it("uses the full unfiltered subtree for descendant recency grouping", () => {
    const projection = projectSessionTree(
      [
        session("old", "Old root", undefined, now - 14 * day),
        session("recent", "Recent match", "old", now - 1 * 60 * 60 * 1000),
      ],
      "match",
      now,
    );
    expect(projection.groups.map((group) => group.id)).toEqual(["today"]);
    expect(ids(projection.groups[0]?.roots ?? [])).toEqual(["old"]);
  });

  it("falls back to created timestamps only when all updated timestamps are invalid", () => {
    const projection = projectSessionTree(
      [
        session("created", "Created", undefined, Number.NaN, now - 2 * day),
        session("invalid", "Invalid", undefined, Number.POSITIVE_INFINITY, Number.NaN),
      ],
      "",
      now,
    );
    expect(projection.groups.map((group) => group.id)).toEqual(["this-week", "earlier"]);
    expect(ids(projection.groups[0]?.roots ?? [])).toEqual(["created"]);
    expect(ids(projection.groups[1]?.roots ?? [])).toEqual(["invalid"]);
  });

  it("uses local Monday boundaries and returns groups in display order", () => {
    const wednesday = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-26T10:00:00Z"));
    const projection = projectSessionTree(
      [
        session("earlier", "Earlier", undefined, wednesday - 4 * day),
        session("today", "Today", undefined, wednesday),
        session("week", "Week", undefined, wednesday - day),
      ],
      "",
      wednesday,
    );
    expect(projection.groups.map((group) => group.id)).toEqual(["today", "this-week", "earlier"]);
  });

  it("returns no roots or groups when nothing matches", () => {
    const projection = projectSessionTree([session("one", "One", undefined, now)], "missing", now);
    expect(projection.roots).toEqual([]);
    expect(projection.groups).toEqual([]);
  });
});
