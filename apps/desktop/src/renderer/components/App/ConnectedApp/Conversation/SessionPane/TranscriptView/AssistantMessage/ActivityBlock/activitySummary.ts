import type { SessionMessageAssistant } from "@opencode/client";
import type { WorkDetailInfo } from "../../WorkDetailMessage.tsx";
import { toolParameter } from "../toolParameter.ts";

type Step = Exclude<SessionMessageAssistant["content"][number], { type: "text" }>;

/** Summarize existing SDK data without a second clock or streaming state. */
export function activitySummary(
  steps: readonly Step[],
  details: readonly WorkDetailInfo[],
  active: boolean,
  directory?: string,
): string | undefined {
  if (active) {
    const work = details.findLast(
      (item) => (item.type === "shell" || item.type === "compaction") && item.status === "running",
    );
    if (work?.type === "shell") return `Shell · ${work.command.replace(/\s+/g, " ")}`;
    if (work?.type === "compaction") return "Compacting context";
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

  // Omit the duration when any action has missing or invalid timing. In
  // particular, compaction events do not carry a completion timestamp.
  const times = [
    ...steps.map((step) => step.time),
    ...details.map((item) =>
      item.type === "compaction"
        ? undefined
        : item.type === "shell"
          ? item.time
          : { created: item.time.created, completed: item.time.created },
    ),
  ];
  if (times.length === 0) return undefined;
  let start = Infinity;
  let end = -Infinity;
  for (const time of times) {
    if (
      !time ||
      time.completed === undefined ||
      !Number.isFinite(time.created) ||
      !Number.isFinite(time.completed) ||
      time.completed < time.created
    )
      return undefined;
    start = Math.min(start, time.created);
    end = Math.max(end, time.completed);
  }
  const seconds = Math.round((end - start) / 1000);
  if (seconds === 0) return "<1s";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
