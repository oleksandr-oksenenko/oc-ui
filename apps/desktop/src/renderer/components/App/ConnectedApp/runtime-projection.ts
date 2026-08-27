import type { SessionInfo } from "@opencode-ai/client";
import type { SessionNode } from "./AppShell/Workspace/SessionSidebar.tsx";
import type { DataSessionStatus } from "@opencode-ai/client/solid";

type SessionStatusLookup = (sessionID: string) => DataSessionStatus;
type RuntimeSession = Pick<SessionInfo, "id" | "title">;

/** Projects only runtime-backed, flat session fields into the sidebar contract. */
export function projectRuntimeSessionNodes(
  sessions: readonly RuntimeSession[],
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
