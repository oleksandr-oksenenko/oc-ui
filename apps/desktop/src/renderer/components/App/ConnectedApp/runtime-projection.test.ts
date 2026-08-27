import { describe, expect, it } from "vite-plus/test";

import { projectRuntimeSessionNodes } from "./runtime-projection.ts";

const session = (id: string, title?: string) => ({ id, title });

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
});
