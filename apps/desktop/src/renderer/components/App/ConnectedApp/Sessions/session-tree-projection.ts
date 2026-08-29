import type { SessionInfo } from "@opencode-ai/client";
import { DateTime } from "effect";

export type SessionTreeNode = {
  readonly session: SessionInfo;
  readonly children: readonly SessionTreeNode[];
};

type SessionTreeGroupID = "today" | "this-week" | "earlier";

type SessionTreeGroup = {
  readonly id: SessionTreeGroupID;
  readonly label: string;
  readonly roots: readonly SessionTreeNode[];
};

export type SessionTreeProjection = {
  readonly roots: readonly SessionTreeNode[];
  readonly groups: readonly SessionTreeGroup[];
};

const groupOrder: readonly SessionTreeGroupID[] = ["today", "this-week", "earlier"];
const groupLabels = {
  today: "Today",
  "this-week": "This week",
  earlier: "Earlier",
} satisfies Record<SessionTreeGroupID, string>;

function validTimestamp(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

function startOfLocalDay(timestamp: number): number {
  const local = DateTime.setZone(DateTime.makeUnsafe(timestamp), DateTime.zoneMakeLocal());
  return DateTime.toEpochMillis(DateTime.startOf(local, "day"));
}

function startOfLocalWeek(timestamp: number): number {
  const local = DateTime.setZone(DateTime.makeUnsafe(timestamp), DateTime.zoneMakeLocal());
  return DateTime.toEpochMillis(DateTime.startOf(local, "week", { weekStartsOn: 1 }));
}

function groupForTimestamp(
  timestamp: number | undefined,
  todayStart: number,
  weekStart: number,
): SessionTreeGroupID {
  if (!validTimestamp(timestamp) || timestamp < weekStart) return "earlier";
  if (timestamp >= todayStart) return "today";
  return "this-week";
}

export function projectSessionTree(
  sessions: readonly SessionInfo[],
  query: string,
  now = DateTime.toEpochMillis(DateTime.nowUnsafe()),
): SessionTreeProjection {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  const childrenByID = new Map<string, SessionInfo[]>();
  const roots: SessionInfo[] = [];

  for (const session of sessions) {
    if (session.parentID === undefined || !byID.has(session.parentID)) {
      roots.push(session);
    } else {
      const children = childrenByID.get(session.parentID) ?? [];
      children.push(session);
      childrenByID.set(session.parentID, children);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const titleMatches = (session: SessionInfo): boolean =>
    (session.title?.trim() || "Untitled session").toLowerCase().includes(normalizedQuery);

  const buildNode = (session: SessionInfo, filter: boolean): SessionTreeNode | undefined => {
    const children = (childrenByID.get(session.id) ?? [])
      .map((child) => buildNode(child, filter))
      .filter((child): child is SessionTreeNode => child !== undefined);
    if (filter && !titleMatches(session) && children.length === 0) return undefined;
    return { session, children };
  };

  const filteredRoots = roots
    .map((root) => buildNode(root, normalizedQuery.length > 0))
    .filter((root): root is SessionTreeNode => root !== undefined);

  const subtreeTimes = (session: SessionInfo, key: "created" | "updated"): number[] => [
    ...(validTimestamp(session.time[key]) ? [session.time[key]] : []),
    ...(childrenByID.get(session.id) ?? []).flatMap((child) => subtreeTimes(child, key)),
  ];
  const subtreeTime = (session: SessionInfo): number | undefined => {
    const updated = subtreeTimes(session, "updated");
    if (updated.length > 0) return Math.max(...updated);
    const created = subtreeTimes(session, "created");
    return created.length > 0 ? Math.max(...created) : undefined;
  };

  const todayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  const groups = groupOrder
    .map((id) => ({
      id,
      label: groupLabels[id],
      roots: filteredRoots.filter(
        (root) => groupForTimestamp(subtreeTime(root.session), todayStart, weekStart) === id,
      ),
    }))
    .filter((group) => group.roots.length > 0);

  return { roots: filteredRoots, groups };
}
