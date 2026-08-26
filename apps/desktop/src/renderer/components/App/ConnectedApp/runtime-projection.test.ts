import type { SessionInfo } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import { projectRuntimeSessionNodes, projectRuntimeTranscript } from "./runtime-projection.ts";

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

  it("keeps multiline assistant text in one paragraph payload", () => {
    const text = "First line\n\nSecond line\n- still plain runtime text";

    expect(
      projectRuntimeTranscript([
        { kind: "assistant", id: "assistant-1", textBlocks: [text], state: "complete" },
      ]),
    ).toEqual([
      {
        kind: "assistant",
        id: "assistant-1",
        state: "complete",
        blocks: [{ kind: "paragraph", content: text }],
      },
    ]);
  });

  it("does not fabricate fixture-only reasoning or tool blocks", () => {
    const [message] = projectRuntimeTranscript([
      { kind: "assistant", id: "assistant-1", textBlocks: ["Visible text"], state: "streaming" },
    ]);

    expect(message).toEqual({
      kind: "assistant",
      id: "assistant-1",
      state: "streaming",
      blocks: [{ kind: "paragraph", content: "Visible text" }],
    });
  });
});
