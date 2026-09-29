import type { SessionMessageInfo } from "@opencode/client";

/**
 * The routine work details that belong inside Activity. An explicit whitelist
 * keeps a future SDK message kind from silently becoming routine work, and
 * leaves the remaining details as top-level transcript rows.
 */
export type ActivityDetailInfo = Extract<
  SessionMessageInfo,
  { readonly type: "shell" | "skill" | "synthetic" }
>;

type RenderableMessage = Exclude<SessionMessageInfo, { readonly type: "idle" }>;

export type TranscriptRow = {
  readonly message: RenderableMessage;
  readonly workDetails: readonly ActivityDetailInfo[];
  /** A later run of routine details after an exposed error or context row. */
  readonly activityGroup?: true;
};

/**
 * True for a message that owns its own top-level row. It ends the current
 * Activity run without ending the assistant turn, so routine work after it
 * starts a new run instead of rejoining the assistant's group. A future SDK
 * message kind matches neither this predicate nor ActivityDetailInfo, so it
 * fails to compile here instead of silently joining an Activity run.
 */
function isExposedEvent(
  message: RenderableMessage,
): message is Extract<
  RenderableMessage,
  { readonly type: "compaction" | "agent-switched" | "model-switched" | "location-switched" }
> {
  switch (message.type) {
    case "compaction":
    case "agent-switched":
    case "model-switched":
    case "location-switched":
      return true;
    default:
      return false;
  }
}

/** Groups work details with their preceding assistant message in the same turn. */
export function projectTranscriptRows(messages: readonly SessionMessageInfo[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let group: ActivityDetailInfo[] | undefined;
  let inAssistantTurn = false;
  for (const message of messages) {
    if (message.type === "idle") {
      group = undefined;
      inAssistantTurn = false;
      continue;
    }
    if (message.type === "assistant") {
      const workDetails: ActivityDetailInfo[] = [];
      rows.push({ message, workDetails });
      group = message.error === undefined && message.finish !== "error" ? workDetails : undefined;
      inAssistantTurn = true;
      continue;
    }
    if (message.type === "user" || message.type === "system") {
      rows.push({ message, workDetails: [] });
      group = undefined;
      inAssistantTurn = false;
      continue;
    }
    // An exposed event ends the current Activity run but keeps the turn open, so
    // routine work after it starts a new run instead of rejoining the assistant's
    // group. Outside a turn it must not start one: an out-of-turn detail stays a
    // visible row.
    if (isExposedEvent(message)) {
      rows.push({ message, workDetails: [] });
      group = undefined;
      continue;
    }
    if (inAssistantTurn) {
      if (group === undefined) {
        group = [];
        rows.push({ message, workDetails: group, activityGroup: true });
      }
      group.push(message);
      continue;
    }
    rows.push({ message, workDetails: [] });
  }
  return rows;
}
