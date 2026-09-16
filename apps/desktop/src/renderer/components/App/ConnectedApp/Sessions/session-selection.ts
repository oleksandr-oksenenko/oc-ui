import type { SessionInfo } from "@opencode/client";

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

/** Returns the selected session followed by all of its descendants. */
export function sessionSubtreeIDs(
  sessionID: string,
  sessions: readonly SessionInfo[],
): readonly string[] {
  const children = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.parentID === undefined) continue;
    const siblings = children.get(session.parentID) ?? [];
    siblings.push(session.id);
    children.set(session.parentID, siblings);
  }

  const result: string[] = [];
  const pending = [sessionID];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    result.push(current);
    pending.push(...(children.get(current) ?? []).toReversed());
  }
  return result;
}
