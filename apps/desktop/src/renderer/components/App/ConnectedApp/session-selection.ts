import type { SessionInfo } from "@opencode-ai/client";

/** Returns nearest-first ancestors while the selected session still exists. */
export function sessionAncestorIDs(
  sessionID: string,
  sessions: readonly SessionInfo[],
): readonly string[] {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  const ancestors: string[] = [];
  let parentID = byID.get(sessionID)?.parentID;
  while (parentID !== undefined) {
    ancestors.push(parentID);
    parentID = byID.get(parentID)?.parentID;
  }
  return ancestors;
}

export function chooseSessionFallback(
  ancestorIDs: readonly string[],
  sessions: readonly SessionInfo[],
): string | undefined {
  const available = new Set(sessions.map((session) => session.id));
  return ancestorIDs.find((id) => available.has(id)) ?? sessions[0]?.id;
}
