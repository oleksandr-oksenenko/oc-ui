import type { SessionMessageInfo, SessionMessageAssistant } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { projectTranscriptRows } from "./workDetailProjection.ts";

const time = { created: 1 };
const assistant = (id: string): SessionMessageAssistant => ({
  id,
  type: "assistant",
  time,
  agent: "build",
  model: { providerID: "p", id: "m" },
  content: [{ type: "text", text: id }],
});
const shell = (id: string, exit: number): SessionMessageInfo => ({
  id,
  type: "shell",
  time,
  shellID: id,
  command: id,
  status: "exited",
  exit,
});

const ids = (rows: ReturnType<typeof projectTranscriptRows>) =>
  rows.map((row) => [row.message.id, row.workDetails.map((item) => item.id)]);

describe("projectTranscriptRows", () => {
  it("chains prefix activity across cycles and stops at prose, exposed events and turn boundaries", () => {
    const activity = (id: string): SessionMessageAssistant => ({
      ...assistant(id),
      content: [{ type: "reasoning", text: id }],
    });
    const first = activity("first");
    const second = activity("second");
    const prose = {
      ...activity("prose"),
      content: [...activity("prose").content, { type: "text" as const, text: "Progress" }],
    };
    const rows = projectTranscriptRows([
      first,
      shell("between", 0),
      second,
      prose,
      activity("after-prose"),
      { ...assistant("empty"), content: [] },
      shell("empty-details", 0),
      activity("after-empty"),
      { id: "model", type: "model-switched", time, model: { providerID: "p", id: "m" } },
      activity("after-event"),
      { id: "idle", type: "idle", time, outcome: "succeeded" },
      activity("after-idle"),
    ]);
    expect(rows[0]?.message).toBe(first);
    expect(rows[0]?.continuations?.map((row) => row.message)).toEqual([second, prose]);
    expect(rows[0]?.workDetails.map((detail) => detail.id)).toEqual(["between"]);
    expect(
      rows.filter((row) => row.chainedTo).map((row) => [row.message.id, row.chainedTo]),
    ).toEqual([
      ["second", "first"],
      ["prose", "first"],
    ]);
  });

  it("groups completed details in source order and keeps turn boundaries outside Activity", () => {
    const rows = projectTranscriptRows([
      { id: "user-1", type: "user", time, text: "Start" },
      assistant("assistant-1"),
      shell("shell-ok", 0),
      { id: "skill", type: "skill", time, skill: "review", name: "Review", text: "Done" },
      { id: "context", type: "synthetic", time, text: "Inserted context" },
      { id: "idle", type: "idle", time, outcome: "succeeded" },
      shell("outside", 0),
      { id: "user-2", type: "user", time, text: "Next" },
    ]);
    expect(ids(rows)).toEqual([
      ["user-1", []],
      ["assistant-1", ["shell-ok", "skill"]],
      ["context", []],
      ["outside", []],
      ["user-2", []],
    ]);
  });

  it("groups live and failed work in source order while keeping system context outside", () => {
    const rows = projectTranscriptRows([
      assistant("assistant"),
      shell("shell-ok", 0),
      shell("shell-failed", 1),
      { id: "context", type: "synthetic", time, text: "After failure" },
      {
        id: "compaction-running",
        type: "compaction",
        time,
        status: "running",
        reason: "auto",
        summary: "",
        recent: "",
      },
      { id: "location", type: "location-switched", time, location: { directory: "/tmp" } },
      { id: "system", type: "system", time, text: "User-facing context" },
    ]);
    expect(ids(rows)).toEqual([
      ["assistant", ["shell-ok", "shell-failed"]],
      ["context", []],
      ["compaction-running", []],
      ["location", []],
      ["system", []],
    ]);
    expect(rows.filter((row) => row.activityGroup)).toHaveLength(0);
  });

  it("keeps an exposed event top-level and continues the turn in a new Activity run", () => {
    const rows = projectTranscriptRows([
      assistant("assistant"),
      shell("before", 0),
      { id: "model", type: "model-switched", time, model: { providerID: "p", id: "m" } },
      { id: "skill", type: "skill", time, skill: "review", name: "Review", text: "Done" },
      shell("after", 0),
      { id: "agent", type: "agent-switched", time, agent: "plan" },
      { id: "idle", type: "idle", time, outcome: "succeeded" },
      shell("next-turn", 0),
    ]);
    expect(ids(rows)).toEqual([
      ["assistant", ["before"]],
      ["model", []],
      ["skill", ["skill", "after"]],
      ["agent", []],
      ["next-turn", []],
    ]);
    expect(rows.filter((row) => row.activityGroup).map((row) => row.message.id)).toEqual(["skill"]);
  });

  it("exposes context between work runs and breaks assistant activity chaining", () => {
    const activity = (id: string): SessionMessageAssistant => ({
      ...assistant(id),
      content: [{ type: "reasoning", text: id }],
    });
    const rows = projectTranscriptRows([
      activity("before"),
      { id: "context", type: "synthetic", time, text: "Continuing after restart" },
      shell("after-context", 0),
      activity("after"),
    ]);
    expect(ids(rows)).toEqual([
      ["before", []],
      ["context", []],
      ["after-context", ["after-context"]],
      ["after", []],
    ]);
    expect(rows.filter((row) => row.chainedTo)).toHaveLength(0);
    expect(rows[0]?.continuations).toEqual([]);
  });

  it("does not let an exposed event start a turn outside one", () => {
    const rows = projectTranscriptRows([
      assistant("assistant"),
      { id: "idle", type: "idle", time, outcome: "succeeded" },
      { id: "model", type: "model-switched", time, model: { providerID: "p", id: "m" } },
      shell("out-of-turn", 0),
      { id: "system", type: "system", time, text: "Context" },
      { id: "location", type: "location-switched", time, location: { directory: "/tmp" } },
      { id: "skill", type: "skill", time, skill: "review", name: "Review", text: "Done" },
    ]);
    expect(ids(rows)).toEqual([
      ["assistant", []],
      ["model", []],
      ["out-of-turn", []],
      ["system", []],
      ["location", []],
      ["skill", []],
    ]);
    expect(rows.filter((row) => row.activityGroup)).toHaveLength(0);
  });

  it("keeps assistant errors exposed and groups subsequent details until the next boundary", () => {
    const failed: SessionMessageAssistant = { ...assistant("failed"), finish: "error" };
    const rows = projectTranscriptRows([
      failed,
      shell("first", 0),
      shell("second", 1),
      { id: "user", type: "user", time, text: "Try again" },
      shell("outside", 0),
      assistant("recovered"),
      shell("last", 0),
    ]);
    expect(ids(rows)).toEqual([
      ["failed", []],
      ["first", ["first", "second"]],
      ["user", []],
      ["outside", []],
      ["recovered", ["last"]],
    ]);
    expect(rows.filter((row) => row.activityGroup).map((row) => row.message.id)).toEqual(["first"]);
    expect(rows[0]?.message).toBe(failed);
  });
});
