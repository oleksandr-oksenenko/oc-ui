import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client";

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
  /** Prefix activity rendered in the preceding consecutive activity group. */
  readonly chainedTo?: string;
  readonly continuations?: readonly ActivityContinuation[];
};

export type ActivityContinuation = {
  readonly message: SessionMessageAssistant;
  readonly workDetails: readonly ActivityDetailInfo[];
};

function isActivity(part: SessionMessageAssistant["content"][number] | undefined): boolean {
  return part !== undefined && part.type !== "text";
}

function isActivityOnly(message: SessionMessageAssistant): boolean {
  return message.content.length > 0 && message.content.every(isActivity);
}

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
  let chain: (TranscriptRow & { continuations: ActivityContinuation[] }) | undefined;
  for (const message of messages) {
    if (message.type === "idle") {
      chain = undefined;
      group = undefined;
      inAssistantTurn = false;
      continue;
    }
    if (message.type === "assistant") {
      const workDetails: ActivityDetailInfo[] = [];
      const continuations: ActivityContinuation[] = [];
      const failed = message.error !== undefined || message.finish === "error";
      const chainedTo = !failed && isActivity(message.content[0]) ? chain?.message.id : undefined;
      if (chainedTo !== undefined) chain!.continuations.push({ message, workDetails });
      const row = { message, workDetails, continuations, chainedTo };
      rows.push(row);
      if (failed || !isActivityOnly(message)) chain = undefined;
      if (!failed && isActivity(message.content.at(-1))) {
        chain ??= row;
      }
      group = failed ? undefined : workDetails;
      inAssistantTurn = true;
      continue;
    }
    if (message.type === "user" || message.type === "system") {
      chain = undefined;
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
      chain = undefined;
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
