import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";

import type { TranscriptItem } from "../../../domain/transcript.ts";
import type { SessionNode } from "./AppShell/Workspace/SessionSidebar.tsx";
import type { TranscriptMessage } from "./AppShell/Workspace/SessionPane/transcript-types.ts";

type SessionStatusLookup = (sessionID: string) => DataSessionStatus;

/** Projects only runtime-backed, flat session fields into the sidebar contract. */
export function projectRuntimeSessionNodes(
  sessions: readonly SessionInfo[],
  statusForSession: SessionStatusLookup,
  creatingID?: string,
): readonly SessionNode[] {
  return sessions.map((session) => ({
    id: session.id,
    title: session.title?.trim() || "Untitled session",
    status:
      creatingID === session.id
        ? "creating"
        : statusForSession(session.id) === "running"
          ? "running"
          : "idle",
  }));
}

/** Projects the supported text-only runtime transcript into the richer view contract. */
export function projectRuntimeTranscript(
  items: readonly TranscriptItem[],
): readonly TranscriptMessage[] {
  return items.map((item): TranscriptMessage =>
    item.kind === "user"
      ? item
      : {
          kind: "assistant",
          id: item.id,
          state: item.state,
          blocks: item.textBlocks.map((text) => ({ kind: "paragraph", content: text })),
        },
  );
}
