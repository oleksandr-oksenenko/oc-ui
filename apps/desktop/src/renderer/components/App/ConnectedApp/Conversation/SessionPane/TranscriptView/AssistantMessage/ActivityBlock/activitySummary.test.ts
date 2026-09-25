import type { SessionMessageAssistantTool } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";
import { activitySummary } from "./activitySummary.ts";

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

describe("activitySummary", () => {
  it("measures elapsed time across overlapping tools instead of adding their durations", () => {
    expect(activitySummary([tool(1000, 33000), tool(2000, 30000)], [], false)).toBe("32s");
    expect(activitySummary([tool(1000, 66000)], [], false)).toBe("1m 5s");
  });
  it("does not invent duration for missing or invalid timestamps", () => {
    expect(
      activitySummary([{ type: "reasoning", text: "Thinking" }, tool(1, 2000)], [], false),
    ).toBeUndefined();
    expect(activitySummary([tool(1000)], [], false)).toBeUndefined();
    expect(activitySummary([tool(1000, 500)], [], false)).toBeUndefined();
    expect(activitySummary([tool(0, NaN)], [], false)).toBeUndefined();
    expect(activitySummary([], [], false)).toBeUndefined();
  });
  it("shows the running action using the existing relative-path summary", () => {
    expect(activitySummary([tool(1000)], [], true, "/workspace")).toBe("read · src/app.ts");
    expect(activitySummary([tool(1000, 2000)], [], true)).toBeUndefined();
    expect(
      activitySummary(
        [{ type: "reasoning", text: "Private detail", time: { created: 1 } }],
        [],
        true,
      ),
    ).toBe("Reasoning");
  });
  it("prefers a running work-detail action and omits untimed compaction duration", () => {
    const compaction = {
      type: "compaction",
      id: "compact",
      time: { created: 100 },
      status: "running",
      reason: "auto",
      summary: "",
      recent: "",
    } as const;
    expect(activitySummary([tool(1)], [compaction], true)).toBe("Compacting context");
    expect(
      activitySummary([tool(1, 2000)], [{ ...compaction, status: "completed" }], false),
    ).toBeUndefined();
  });
});
