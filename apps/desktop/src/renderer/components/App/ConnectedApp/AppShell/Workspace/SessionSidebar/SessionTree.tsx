import { ScrollView } from "@opencode-ai/ui/scroll-view";
import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { For, createMemo } from "solid-js";

import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";
import "./SessionTree.css";

export type SessionTreeProps = {
  readonly sessions: readonly SessionInfo[];
  readonly statusForSession: (sessionID: string) => DataSessionStatus;
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly canDelete: boolean;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

export function SessionTree(props: SessionTreeProps) {
  const isExpanded = (id: string) => props.expandedIDs.includes(id);
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

  const hasRunningSession = (sessionID: string): boolean => {
    if (props.statusForSession(sessionID) === "running") return true;
    return (hierarchy().children.get(sessionID) ?? []).some((child) => hasRunningSession(child.id));
  };

  const renderSessions = (sessions: readonly SessionInfo[], depth: number) => (
    <For each={sessions}>
      {(session) => {
        const children = () => hierarchy().children.get(session.id) ?? [];
        return (
          <>
            <SessionTreeItem
              session={session}
              status={props.statusForSession(session.id)}
              hasChildren={children().length > 0}
              depth={depth}
              selected={props.selectedID === session.id}
              expanded={isExpanded(session.id)}
              deleteDisabled={!props.canDelete || hasRunningSession(session.id)}
              deleteDisabledReason={
                !props.canDelete
                  ? "Reconnect to delete this session"
                  : hasRunningSession(session.id)
                    ? "Wait for this session and its child sessions to finish before deleting"
                    : undefined
              }
              onSelect={props.onSelect}
              onToggleExpanded={props.onToggleExpanded}
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
    <ScrollView class="shell-session-tree">
      <nav class="shell-session-tree-content" aria-label="Sessions">
        {renderSessions(hierarchy().roots, 0)}
      </nav>
    </ScrollView>
  );
}
