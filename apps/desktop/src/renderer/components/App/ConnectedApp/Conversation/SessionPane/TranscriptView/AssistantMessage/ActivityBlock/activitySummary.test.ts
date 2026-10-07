import type {
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageShell,
  SessionMessageSkill,
} from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";
import { activityLabel } from "./activitySummary.ts";

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

describe("activityLabel", () => {
  it("names thought alongside tools and sums only reasoning time, excluding gaps and tools", () => {
    const first: SessionMessageAssistantReasoning = {
      type: "reasoning",
      text: "First thought",
      time: { created: 1000, completed: 2500 },
    };
    const second: SessionMessageAssistantReasoning = {
      type: "reasoning",
      text: "Second thought",
      time: { created: 10000, completed: 12000 },
    };
    expect(activityLabel([first], [])).toBe("Thought for 2 s");
    expect(
      activityLabel(
        [first, { ...named("read", "read"), time: { created: 2500, completed: 10000 } }, second],
        [],
      ),
    ).toBe("Read 1 file, thought for 4 s");
    expect(activityLabel([{ ...first, time: { created: 1, completed: 2 } }], [])).toBe(
      "Thought for 1 s",
    );
  });

  it("uses Thought when timing is missing or invalid, without reporting a partial duration", () => {
    for (const time of [
      undefined,
      { created: 1 },
      { created: 2, completed: 1 },
      { created: 1, completed: NaN },
      { created: 1, completed: 1 },
    ]) {
      expect(activityLabel([{ type: "reasoning", text: "Thought", time }], [])).toBe("Thought");
    }
    expect(
      activityLabel(
        [
          { type: "reasoning", text: "Timed", time: { created: 1000, completed: 4000 } },
          { type: "reasoning", text: "Untimed" },
        ],
        [],
      ),
    ).toBe("Thought");
  });

  it("keeps current reasoning Thinking until it settles, even without timestamps", () => {
    const thinking: SessionMessageAssistantReasoning = { type: "reasoning", text: "Thinking" };
    expect(activityLabel([thinking], [], true)).toBe("Thinking");
    expect(activityLabel([thinking], [], false)).toBe("Thought");
    expect(activityLabel([thinking, named("read", "read")], [], true)).toBe("Read 1 file, thought");
    expect(activityLabel([named("read", "read"), thinking], [], true)).toBe(
      "Read 1 file, thinking",
    );
    expect(activityLabel([{ type: "reasoning", text: "Earlier" }, thinking], [], true)).toBe(
      "Thought, thinking",
    );
  });

  it("names mixed operations in a stable order and keeps single-operation labels", () => {
    expect(
      activityLabel(
        [named("a", "read"), named("b", "read"), named("c", "grep"), named("d", "edit")],
        [],
      ),
    ).toBe("Read 2 files, updated 1 file, ran 1 search");
    expect(activityLabel([named("a", "read")], [])).toBe("Read 1 file");
    expect(activityLabel([], [shell("ok", 0), shell("ok-2", 0)])).toBe("Ran 2 commands");
  });

  it("keeps distinct operations apart and folds unknown tools together", () => {
    expect(
      activityLabel(
        [named("a", "write"), named("b", "patch"), named("c", "webfetch"), named("d", "mcp__x")],
        [],
      ),
    ).toBe("Wrote 1 file, applied 1 patch, fetched 1 page, used 1 other tool");
    expect(activityLabel([named("a", "execute"), named("b", "custom")], [])).toBe(
      "Used 2 other tools",
    );
  });

  it("shares the ran verb for searches and commands regardless of arrival order", () => {
    expect(
      activityLabel(
        [
          named("command", "shell"),
          named("first", "read"),
          named("second", "read"),
          named("search", "grep"),
        ],
        [shell("one", 0), shell("two", 0), shell("three", 1)],
      ),
    ).toBe("Read 2 files, ran 1 search, 4 commands");
    expect(activityLabel([named("search", "grep")], [shell("command", 0)])).toBe(
      "Ran 1 search, 1 command",
    );
    expect(
      activityLabel(
        [named("search", "grep"), shellTool("background", { status: "running" })],
        [shell("command", 0)],
      ),
    ).toBe("Ran 1 search, 1 command, started 1 command");
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

  it("counts skill loads and ignores outcome metadata on non-shell tools", () => {
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
