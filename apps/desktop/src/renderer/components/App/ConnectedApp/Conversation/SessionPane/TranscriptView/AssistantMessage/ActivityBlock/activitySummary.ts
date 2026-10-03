import type { SessionMessageAssistant } from "@opencode/client";
import { Schema } from "effect";

import type { ActivityDetailInfo } from "../../workDetailProjection.ts";

type Step = Exclude<SessionMessageAssistant["content"][number], { type: "text" }>;

/** A completed shell tool reports how its command ended through metadata. */
const shellMetadata = Schema.Struct({
  status: Schema.optionalKey(Schema.Literals(["running", "completed", "timeout", "killed"])),
  exit: Schema.optionalKey(Schema.Finite),
  timeout: Schema.optionalKey(Schema.Boolean),
});

/** Tool names that run a shell command and report its outcome in metadata. */
const SHELL_TOOLS = new Set(["shell", "bash"]);

/**
 * How a shell tool step's command ended, or undefined when the step is not a
 * shell tool. The tool state alone only proves the invocation returned: a
 * command moved to the background reports `running`, and a timed-out or
 * nonzero-exit command still reports `completed`.
 */
export function shellCommandOutcome(
  step: SessionMessageAssistant["content"][number],
): "running" | "succeeded" | "failed" | undefined {
  if (step.type !== "tool" || !SHELL_TOOLS.has(step.name)) return undefined;
  if (step.state.status === "error") return "failed";
  if (step.state.status !== "completed") return "running";
  const decoded = Schema.decodeOption(shellMetadata)(step.state.metadata ?? {});
  if (decoded._tag === "None") return "succeeded";
  const { status, exit, timeout } = decoded.value;
  if (status === "running") return "running";
  if (status === "timeout" || timeout === true) return "failed";
  if (exit !== undefined && exit !== 0) return "failed";
  return "succeeded";
}

/**
 * A completed step's contribution to the header label. The verb describes the
 * operation that ran, not its result: a read call counts once whether it
 * touched a file or a directory, and a patch counts once whether it changed
 * one file or many.
 */
type Operation = {
  readonly verb: string;
  readonly singular: string;
  readonly plural: string;
};

// A successful read call may have listed a directory; the pinned tool reports
// only `{ truncated }`, so the transcript cannot tell a listing from a file.
const READ: Operation = { verb: "Read", singular: "file", plural: "files" };
const WROTE: Operation = { verb: "Wrote", singular: "file", plural: "files" };
const UPDATED: Operation = { verb: "Updated", singular: "file", plural: "files" };
const PATCHED: Operation = { verb: "Applied", singular: "patch", plural: "patches" };
const SEARCHED: Operation = { verb: "Ran", singular: "search", plural: "searches" };
const FETCHED: Operation = { verb: "Fetched", singular: "page", plural: "pages" };
const RAN: Operation = { verb: "Ran", singular: "command", plural: "commands" };
const STARTED: Operation = { verb: "Started", singular: "command", plural: "commands" };
const DELEGATED: Operation = { verb: "Delegated", singular: "task", plural: "tasks" };
const LOADED: Operation = { verb: "Loaded", singular: "skill", plural: "skills" };
const ASKED: Operation = { verb: "Asked", singular: "question", plural: "questions" };
const OTHER: Operation = { verb: "Used", singular: "other tool", plural: "other tools" };

/** Exact tool names and the operation each carries out. */
const OPERATIONS = new Map<string, Operation>([
  ["read", READ],
  ["write", WROTE],
  ["edit", UPDATED],
  ["apply_patch", PATCHED],
  ["patch", PATCHED],
  ["glob", SEARCHED],
  ["grep", SEARCHED],
  ["websearch", SEARCHED],
  ["webfetch", FETCHED],
  ["bash", RAN],
  ["shell", RAN],
  ["subagent", DELEGATED],
  ["skill", LOADED],
  ["question", ASKED],
]);

// Keep operations with the same verb adjacent so the label names that verb once.
const LABEL_OPERATIONS = [
  READ,
  WROTE,
  UPDATED,
  PATCHED,
  FETCHED,
  SEARCHED,
  RAN,
  STARTED,
  DELEGATED,
  LOADED,
  ASKED,
  OTHER,
];

/** Only complete timing for all settled reasoning can describe thought duration. */
function thoughtLabel(steps: readonly Step[], active: boolean): string | undefined {
  let thought = false;
  let thinking = false;
  let duration: number | undefined = 0;
  for (const step of steps) {
    if (step.type !== "reasoning") continue;
    // Earlier reasoning has ended once another step follows, even when the
    // provider omitted its completion timestamp.
    if (active && step === steps.at(-1) && step.time?.completed === undefined) {
      thinking = true;
      continue;
    }
    thought = true;
    const time = step.time;
    if (
      time?.completed === undefined ||
      !Number.isFinite(time.created) ||
      !Number.isFinite(time.completed) ||
      time.completed < time.created
    ) {
      duration = undefined;
    } else if (duration !== undefined) {
      duration += time.completed - time.created;
    }
  }
  if (!thought) return thinking ? "Thinking" : undefined;
  const label =
    duration !== undefined && Number.isFinite(duration) && duration > 0
      ? `Thought for ${Math.max(1, Math.round(duration / 1000))} s`
      : "Thought";
  return thinking ? `${label}, thinking` : label;
}

/**
 * Name reasoning and completed operations, sharing verbs: "Ran 1 search, 4 commands".
 * Failures still count as attempted operations.
 * Running and streaming calls are excluded; background commands count as started.
 */
export function activityLabel(
  steps: readonly Step[],
  details: readonly ActivityDetailInfo[],
  active = false,
): string | undefined {
  const counts = new Map<Operation, number>();
  const count = (operation: Operation) => {
    counts.set(operation, (counts.get(operation) ?? 0) + 1);
  };
  for (const step of steps) {
    if (step.type !== "tool") continue;
    const operation = OPERATIONS.get(step.name) ?? OTHER;
    const outcome = shellCommandOutcome(step);
    if (outcome === "running") {
      // The invocation returned while its command keeps running.
      if (step.state.status === "completed") count(STARTED);
      continue;
    }
    if (step.state.status !== "completed" && step.state.status !== "error") continue;
    count(operation);
  }
  for (const detail of details) {
    if (detail.type === "shell") {
      // A shell row that exited, timed out, or was killed all ran.
      if (detail.status === "running") continue;
      count(RAN);
      continue;
    }
    count(LOADED);
  }
  const clauses: string[] = [];
  let previousVerb: string | undefined;
  for (const operation of LABEL_OPERATIONS) {
    const value = counts.get(operation);
    if (value === undefined) continue;
    const verb =
      operation.verb === previousVerb
        ? ""
        : `${clauses.length === 0 ? operation.verb : operation.verb.toLowerCase()} `;
    clauses.push(`${verb}${value} ${value === 1 ? operation.singular : operation.plural}`);
    previousVerb = operation.verb;
  }
  const thought = thoughtLabel(steps, active);
  if (thought !== undefined) {
    clauses.push(clauses.length === 0 ? thought : thought.toLowerCase());
  }
  return clauses.length === 0 ? undefined : clauses.join(", ");
}
