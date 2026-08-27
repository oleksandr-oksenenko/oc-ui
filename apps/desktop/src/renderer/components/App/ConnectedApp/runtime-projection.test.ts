import type { SessionInfo } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import { projectRuntimeSessionNodes } from "./runtime-projection.ts";

const session = (id: string, title?: string): SessionInfo =>
  ({
    id,
    title,
    projectID: "project",
    cost: 0,
    tokens: {},
    time: { created: 1, updated: 1 },
    location: { directory: "/workspace" },
  }) as SessionInfo;

describe("runtime presentation projection", () => {
  it("maps runtime sessions as a flat list without fixture-only state", () => {
    const nodes = projectRuntimeSessionNodes(
      [session("active", "  Active work  "), session("untitled")],
      (sessionID) => (sessionID === "active" ? "running" : "idle"),
    );

    expect(nodes).toEqual([
      { id: "active", title: "Active work", status: "running" },
      { id: "untitled", title: "Untitled session", status: "idle" },
    ]);
    expect(nodes.every((node) => !("children" in node) && !("needsInput" in node))).toBe(true);
  });

  it("projects the creating state ahead of the server running state", () => {
    expect(projectRuntimeSessionNodes([session("new")], () => "running", "new")).toEqual([
      { id: "new", title: "Untitled session", status: "creating" },
    ]);
  });
});
