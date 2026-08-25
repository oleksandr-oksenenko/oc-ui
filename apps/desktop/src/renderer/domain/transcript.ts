import type { SessionMessageInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";

export type TranscriptItem =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly textBlocks: readonly string[];
      readonly state: "streaming" | "complete" | "failed";
    };

/**
 * Projects complete OpenCode message records into the small transcript view
 * supported by the first renderer slice.
 */
export function projectTranscript(
  messages: readonly SessionMessageInfo[],
  sessionStatus: DataSessionStatus,
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = [];

  for (const message of messages) {
    if (message.type === "user") {
      items.push({
        kind: "user",
        id: message.id,
        text: message.text,
      });
      continue;
    }

    if (message.type !== "assistant") {
      continue;
    }

    const textBlocks = message.content.flatMap((content) =>
      content.type === "text" && content.text.length > 0 ? [content.text] : [],
    );
    const failed = message.error !== undefined || message.finish === "error";
    const state = failed
      ? "failed"
      : message.time.completed === undefined && sessionStatus === "running"
        ? "streaming"
        : "complete";

    items.push({
      kind: "assistant",
      id: message.id,
      textBlocks,
      state,
    });
  }

  return items;
}
