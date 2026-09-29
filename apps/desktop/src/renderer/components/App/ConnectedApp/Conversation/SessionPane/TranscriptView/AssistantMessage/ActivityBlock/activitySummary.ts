import type { SessionMessageAssistant } from "@opencode/client";
import { Schema } from "effect";

import type { ActivityDetailInfo } from "../../workDetailProjection.ts";
import { toolParameter } from "../toolParameter.ts";

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

/** Exact tool names, in the order their clause appears in the label. */
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

const OPERATION_ORDER = [
  READ,
  WROTE,
  UPDATED,
  PATCHED,
  SEARCHED,
  FETCHED,
  RAN,
  STARTED,
  DELEGATED,
  LOADED,
  ASKED,
  OTHER,
];

/**
 * Action label for an Activity header, or undefined when the run carried out no
 * operation to describe. Every operation the run carried out is named, whatever
 * its outcome: the failure badge marks which runs had failures, so a failed
 * command still reads as the command it was. Running and streaming calls are
 * excluded because they have not been carried out yet, and a command moved to
 * the background counts as started rather than run.
 */
export function activityLabel(
  steps: readonly Step[],
  details: readonly ActivityDetailInfo[],
): string | undefined {
  const counts = new Map<Operation, number>();
  const count = (operation: Operation | undefined) => {
    if (operation === undefined) return;
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
      if (detail.status !== "exited" && detail.status !== "timeout" && detail.status !== "killed")
        continue;
      count(RAN);
      continue;
    }
    // A synthetic detail is injected context or a notification, never a tool
    // call, so it contributes no operation.
    if (detail.type === "skill") count(LOADED);
  }
  const clauses: string[] = [];
  for (const operation of OPERATION_ORDER) {
    const value = counts.get(operation);
    if (value === undefined) continue;
    const unit = value === 1 ? operation.singular : operation.plural;
    // Only the opening clause keeps its capital; the rest read as one sentence.
    const verb = clauses.length === 0 ? operation.verb : operation.verb.toLowerCase();
    clauses.push(`${verb} ${value} ${unit}`);
  }
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0]!;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}`;
}

/**
 * The action a live run is performing right now, or undefined when the run is
 * not live or has nothing in flight.
 */
export function activitySummary(
  steps: readonly Step[],
  details: readonly ActivityDetailInfo[],
  active: boolean,
  directory?: string,
): string | undefined {
  if (!active) return undefined;
  const work = details.findLast((item) => item.type === "shell" && item.status === "running");
  if (work?.type === "shell") return `Shell · ${work.command.replace(/\s+/g, " ")}`;
  const step = steps.findLast((item) =>
    item.type === "tool"
      ? item.state.status === "running" || item.state.status === "streaming"
      : item.time !== undefined && item.time.completed === undefined,
  );
  if (step?.type === "reasoning") return "Reasoning";
  if (step?.type === "tool") {
    const parameter = toolParameter(step, directory);
    return parameter ? `${step.name} · ${parameter.text}` : step.name;
  }
  return undefined;
}
