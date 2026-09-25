import type { SessionMessageInfo } from "@opencode/client";

import type { WorkDetailInfo } from "./AssistantMessage/ActivityBlock/WorkDetailMessage.tsx";

type RenderableMessage = Exclude<SessionMessageInfo, { readonly type: "idle" }>;

export type TranscriptRow = {
  readonly message: RenderableMessage;
  readonly workDetails: readonly WorkDetailInfo[];
  /** A later run of routine details after an exposed error or context row. */
  readonly activityGroup?: true;
};

/** Groups work details with their preceding assistant message in the same turn. */
export function projectTranscriptRows(messages: readonly SessionMessageInfo[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let group: WorkDetailInfo[] | undefined;
  let inAssistantTurn = false;
  for (const message of messages) {
    if (message.type === "idle") {
      group = undefined;
      inAssistantTurn = false;
      continue;
    }
    if (message.type === "assistant") {
      const workDetails: WorkDetailInfo[] = [];
      rows.push({ message, workDetails });
      group = message.error === undefined && message.finish !== "error" ? workDetails : undefined;
      inAssistantTurn = true;
      continue;
    }
    if (message.type !== "user" && message.type !== "system" && inAssistantTurn) {
      if (group === undefined) {
        group = [];
        rows.push({ message, workDetails: group, activityGroup: true });
      }
      group.push(message);
      continue;
    }
    rows.push({ message, workDetails: [] });
    group = undefined;
    inAssistantTurn = false;
  }
  return rows;
}
