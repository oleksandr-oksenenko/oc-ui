import { ScrollView } from "@opencode-ai/ui/scroll-view";
import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { DateTime } from "effect";
import { For, Show, createMemo } from "solid-js";

import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";
import "./SessionTree.css";

export type SessionTreeProps = {
  readonly sessions: readonly SessionInfo[];
  readonly statusForSession: (sessionID: string) => DataSessionStatus;
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly canDelete: boolean;
  readonly query?: string;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

function validTimestamp(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

export function SessionTree(props: SessionTreeProps) {
  const isExpanded = (id: string) => props.expandedIDs.includes(id);
  const query = createMemo(() => props.query?.trim().toLowerCase() ?? "");
  const hierarchy = createMemo(() => {
    const byID = new Set(props.sessions.map((session) => session.id));
    const children = new Map<string, SessionInfo[]>();
    const roots: SessionInfo[] = [];

    for (const session of props.sessions) {
      if (session.parentID === undefined || !byID.has(session.parentID)) {
        roots.push(session);
        continue;
      }
      const siblings = children.get(session.parentID) ?? [];
      siblings.push(session);
      children.set(session.parentID, siblings);
    }

    return { roots, children };
  });

  const filteredRoots = createMemo(() => {
    const currentQuery = query();
    if (!currentQuery) return hierarchy().roots;

    const filterTree = (session: SessionInfo): SessionInfo | undefined => {
      const children = hierarchy().children.get(session.id) ?? [];
      const filteredChildren = children
        .map((child) => filterTree(child))
        .filter((child): child is SessionInfo => child !== undefined);
      const title = session.title?.trim() || "Untitled session";
      if (title.toLowerCase().includes(currentQuery) || filteredChildren.length > 0) {
        return session;
      }
      return undefined;
    };

    return hierarchy()
      .roots.map((root) => filterTree(root))
      .filter((root): root is SessionInfo => root !== undefined);
  });

  const filteredChildren = (sessionID: string) => {
    const children = hierarchy().children.get(sessionID) ?? [];
    const currentQuery = query();
    if (!currentQuery) return children;

    const hasMatch = (session: SessionInfo): boolean => {
      const title = session.title?.trim() || "Untitled session";
      return (
        title.toLowerCase().includes(currentQuery) ||
        (hierarchy().children.get(session.id) ?? []).some((child) => hasMatch(child))
      );
    };

    return children.filter((child) => hasMatch(child));
  };

  type TimeGroup = "today" | "this-week" | "earlier";
  type SessionGroups = Record<TimeGroup, SessionInfo[]>;
  const groupLabels = {
    today: "Today",
    "this-week": "This week",
    earlier: "Earlier",
  } satisfies Record<TimeGroup, string>;
  const groupOrder: readonly TimeGroup[] = ["today", "this-week", "earlier"];

  const groupForTime = (
    timestamp: number | undefined,
    todayStart: number,
    weekStart: number,
  ): TimeGroup => {
    if (!validTimestamp(timestamp)) return "earlier";
    if (timestamp >= todayStart) return "today";
    if (timestamp >= weekStart) return "this-week";
    return "earlier";
  };

  const rootGroups = createMemo(() => {
    const now = DateTime.setZone(DateTime.nowUnsafe(), DateTime.zoneMakeLocal());
    const todayStart = DateTime.toEpochMillis(DateTime.startOf(now, "day"));
    const weekStart = DateTime.toEpochMillis(DateTime.startOf(now, "week", { weekStartsOn: 1 }));
    const grouped: SessionGroups = { today: [], "this-week": [], earlier: [] };

    const subtreeTimes = (
      session: SessionInfo,
      key: "created" | "updated",
      seen = new Set<string>(),
    ): number[] => {
      if (seen.has(session.id)) return [];
      const nextSeen = new Set(seen).add(session.id);
      return [
        session.time[key],
        ...(hierarchy().children.get(session.id) ?? []).flatMap((child) =>
          subtreeTimes(child, key, nextSeen),
        ),
      ].filter(validTimestamp);
    };

    const subtreeTime = (session: SessionInfo): number | undefined => {
      const updated = subtreeTimes(session, "updated");
      if (updated.length > 0) return Math.max(...updated);
      const created = subtreeTimes(session, "created");
      return created.length > 0 ? Math.max(...created) : undefined;
    };

    for (const root of filteredRoots()) {
      grouped[groupForTime(subtreeTime(root), todayStart, weekStart)].push(root);
    }
    return grouped;
  });

  const hasRunningSession = (sessionID: string): boolean => {
    if (props.statusForSession(sessionID) === "running") return true;
    return (hierarchy().children.get(sessionID) ?? []).some((child) => hasRunningSession(child.id));
  };

  const renderSessions = (sessions: readonly SessionInfo[], depth: number) => (
    <For each={sessions}>
      {(session) => {
        const children = () => filteredChildren(session.id);
        const filtering = () => query().length > 0;
        return (
          <>
            <SessionTreeItem
              session={session}
              status={props.statusForSession(session.id)}
              hasChildren={children().length > 0}
              depth={depth}
              selected={props.selectedID === session.id}
              expanded={filtering() || isExpanded(session.id)}
              deleteDisabled={!props.canDelete || hasRunningSession(session.id)}
              deleteDisabledReason={
                !props.canDelete
                  ? "Reconnect to delete this session"
                  : hasRunningSession(session.id)
                    ? "Wait for this session and its child sessions to finish before deleting"
                    : undefined
              }
              onSelect={props.onSelect}
              onToggleExpanded={(sessionID) => {
                if (!filtering()) props.onToggleExpanded(sessionID);
              }}
              onDelete={props.onDelete}
            >
              {children().length > 0 ? (
                <div class="shell-session-children" style={{ "--session-depth": `${depth + 1}` }}>
                  {renderSessions(children(), depth + 1)}
                </div>
              ) : null}
            </SessionTreeItem>
          </>
        );
      }}
    </For>
  );

  return (
    <ScrollView class="shell-session-tree" thumbVisibility="scroll">
      <nav class="shell-session-tree-content" aria-label="Sessions">
        <Show
          when={filteredRoots().length > 0}
          fallback={
            <p class="shell-session-no-match">No sessions match “{props.query?.trim()}”.</p>
          }
        >
          <For each={groupOrder}>
            {(group) => {
              const sessions = () => rootGroups()[group];
              return (
                <Show when={sessions().length > 0}>
                  <section
                    class="shell-session-group"
                    aria-labelledby={`shell-session-group-${group}`}
                  >
                    <h2 id={`shell-session-group-${group}`}>{groupLabels[group]}</h2>
                    <div class="shell-session-group-tree">{renderSessions(sessions(), 0)}</div>
                  </section>
                </Show>
              );
            }}
          </For>
        </Show>
      </nav>
    </ScrollView>
  );
}
