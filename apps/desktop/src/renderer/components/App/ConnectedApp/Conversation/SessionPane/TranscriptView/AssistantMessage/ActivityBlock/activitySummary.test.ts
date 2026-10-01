import type {
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageSkill,
  SessionMessageSynthetic,
} from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";
import { activityLabel, activitySummary } from "./activitySummary.ts";

const tool = (created: number, completed?: number): SessionMessageAssistantTool => ({
  type: "tool",
  id: "read",
  name: "read",
  time: { created, completed },
  state:
    completed === undefined
      ? { status: "running", input: { path: "/workspace/src/app.ts" }, metadata: {} }
      : { status: "completed", input: {}, content: [{ type: "text", text: "done" }] },
});

const shell = (id: string, exit: number): SessionMessageShell => ({
  id,
  type: "shell",
  time: { created: 1, completed: 2 },
  shellID: id,
  command: id,
  status: "exited",
  exit,
});

const named = (
  id: string,
  name: string,
  status: "streaming" | "running" | "completed" | "error" = "completed",
): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name,
  time: { created: 1, completed: 2 },
  state:
    status === "completed"
      ? { status, input: {}, content: [{ type: "text", text: "done" }] }
      : status === "streaming"
        ? { status, input: "raw input" }
        : status === "running"
          ? { status, input: {}, metadata: {} }
          : { status, input: {}, error: { type: "tool", message: "failed" } },
});

/** A completed shell tool carrying the outcome metadata the pinned tool emits. */
const shellTool = (
  id: string,
  metadata: Readonly<Record<string, string | number | boolean>>,
): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "shell",
  time: { created: 1, completed: 2 },
  state: {
    status: "completed",
    input: { command: id },
    content: [{ type: "text", text: "command output" }],
    metadata,
  },
});

const skill: SessionMessageSkill = {
  id: "skill",
  type: "skill",
  time: { created: 2000 },
  skill: "review",
  name: "Review",
  text: "Done",
};

const synthetic: SessionMessageSynthetic = {
  id: "synthetic",
  type: "synthetic",
  time: { created: 3000 },
  text: "Inserted context",
};

describe("activityLabel", () => {
  it("counts completed calls per operation in a stable order", () => {
    expect(
      activityLabel(
        [named("a", "read"), named("b", "read"), named("c", "grep"), named("d", "edit")],
        [],
      ),
    ).toBe("Read 2 files, updated 1 file and ran 1 search");
    expect(activityLabel([named("a", "read")], [])).toBe("Read 1 file");
    expect(activityLabel([], [shell("ok", 0), shell("ok-2", 0)])).toBe("Ran 2 commands");
  });

  it("keeps distinct operations apart and folds unknown tools together", () => {
    expect(
      activityLabel(
        [named("a", "write"), named("b", "patch"), named("c", "webfetch"), named("d", "mcp__x")],
        [],
      ),
    ).toBe("Wrote 1 file, applied 1 patch, fetched 1 page and used 1 other tool");
    expect(activityLabel([named("a", "execute"), named("b", "custom")], [])).toBe(
      "Used 2 other tools",
    );
  });

  it("names every operation the run carried out, whatever its outcome", () => {
    expect(
      activityLabel([named("a", "read", "running"), named("b", "read", "streaming")], []),
    ).toBe(undefined);
    // A failed call still names what was attempted; the badge marks the failure.
    expect(activityLabel([named("a", "read", "error")], [])).toBe("Read 1 file");
    expect(activityLabel([named("a", "check", "error")], [])).toBe("Used 1 other tool");
    expect(activityLabel([], [shell("failed", 1)])).toBe("Ran 1 command");
    // The pinned shell tool completes its invocation while the command is still
    // running in the background, timed out, or exited nonzero.
    expect(activityLabel([shellTool("background", { status: "running" })], [])).toBe(
      "Started 1 command",
    );
    expect(activityLabel([shellTool("timeout", { status: "completed", timeout: true })], [])).toBe(
      "Ran 1 command",
    );
    expect(activityLabel([shellTool("nonzero", { status: "completed", exit: 1 })], [])).toBe(
      "Ran 1 command",
    );
    expect(activityLabel([shellTool("ok", { status: "completed", exit: 0 })], [])).toBe(
      "Ran 1 command",
    );
    expect(activityLabel([named("a", "read"), named("b", "read", "error")], [])).toBe(
      "Read 2 files",
    );
  });

  it("counts real tool calls and treats injected context as no operation", () => {
    // A synthetic message is injected context or a notification, never a tool.
    expect(activityLabel([], [synthetic])).toBeUndefined();
    expect(activityLabel([], [skill])).toBe("Loaded 1 skill");
    // Only shell tools carry a command outcome; another tool's metadata is opaque.
    const custom: SessionMessageAssistantTool = {
      ...named("custom", "custom"),
      state: {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: { exit: 1 },
      },
    };
    expect(activityLabel([custom], [])).toBe("Used 1 other tool");
  });
});

describe("activitySummary", () => {
  it("names the running action using the existing relative-path summary", () => {
    expect(activitySummary([tool(1000)], [], true, "/workspace")).toBe("read · src/app.ts");
    expect(activitySummary([tool(1000, 2000)], [], true)).toBeUndefined();
    expect(
      activitySummary(
        [{ type: "reasoning", text: "Private detail", time: { created: 1 } }],
        [],
        true,
      ),
    ).toBe("Reasoning");
    // Missing reasoning completion timestamps must not keep earlier batches live
    // after later tools have already finished.
    expect(
      activitySummary(
        [{ type: "reasoning", text: "Earlier", time: { created: 1 } }, tool(2, 3)],
        [],
        true,
      ),
    ).toBeUndefined();
  });

  it("reports a running shell and never measures a finished run", () => {
    const running: SessionMessageInfo = {
      id: "shell",
      type: "shell",
      time: { created: 1 },
      shellID: "shell",
      command: "pnpm check",
      status: "running",
    };
    expect(activitySummary([tool(1)], [running], true)).toBe("Shell · pnpm check");
    expect(
      activitySummary([tool(1, 2000)], [{ ...running, status: "exited", exit: 0 }], true),
    ).toBeUndefined();
    // A finished run shows its completed actions only: the header carries no
    // elapsed time, whatever the recorded timestamps are.
    expect(activitySummary([tool(1000, 33000)], [], false)).toBeUndefined();
    expect(activitySummary([tool(1000, 33000)], [skill], false)).toBeUndefined();
    expect(activitySummary([tool(0, NaN)], [], false)).toBeUndefined();
    expect(activitySummary([], [], false)).toBeUndefined();
  });
});
