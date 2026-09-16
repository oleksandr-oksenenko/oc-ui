import type { SessionAttention } from "../createSessionAttention.ts";
import { ScrollView } from "@opencode/ui/scroll-view";
import type { SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { For, Show, createMemo } from "solid-js";

import { projectSessionTree, type SessionTreeNode } from "../session-tree-projection.ts";
import type { SessionDeletionStatus } from "../createSessionFlows.ts";
import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";
import "./SessionTree.css";

export type SessionTreeProps = {
  readonly attentionForSession?: (sessionID: string) => SessionAttention | undefined;
  readonly sessions: readonly SessionInfo[];
  readonly now?: number;
  readonly statusForSession: (sessionID: string) => DataSessionStatus;
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly canDelete: boolean;
  readonly deletionStatusForSession: (sessionID: string) => SessionDeletionStatus;
  readonly query?: string;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

export function SessionTree(props: SessionTreeProps) {
  const isExpanded = (id: string) => props.expandedIDs.includes(id);
  const query = createMemo(() => props.query?.trim().toLowerCase() ?? "");
  const projection = createMemo(() => projectSessionTree(props.sessions, query(), props.now));

  const renderSessions = (nodes: readonly SessionTreeNode[]) => (
    <For each={nodes}>
      {(node) => {
        const session = () => node.session;
        const filtering = () => query().length > 0;
        const deleteDisabledReason = createMemo(() => {
          if (!props.canDelete) return "Reconnect to delete this session";
          const status = props.deletionStatusForSession(session().id);
          if (status === "running") {
            return "Wait for this session and its child sessions to finish before deleting";
          }
          if (status === "removed") {
            return "This session is no longer available";
          }
          return undefined;
        });
        return (
          <SessionTreeItem
            session={session()}
            status={props.statusForSession(session().id)}
            attention={props.attentionForSession?.(session().id)}
            hasChildren={node.children.length > 0}
            selected={props.selectedID === session().id}
            expanded={filtering() || isExpanded(session().id)}
            deleteDisabled={deleteDisabledReason() !== undefined}
            deleteDisabledReason={deleteDisabledReason()}
            onSelect={props.onSelect}
            onToggleExpanded={(sessionID) => {
              if (!filtering()) props.onToggleExpanded(sessionID);
            }}
            onDelete={props.onDelete}
          >
            {node.children.length > 0 ? (
              <div class="shell-session-children">{renderSessions(node.children)}</div>
            ) : null}
          </SessionTreeItem>
        );
      }}
    </For>
  );

  return (
    <ScrollView class="shell-session-tree" thumbVisibility="scroll">
      <nav class="shell-session-tree-content" aria-label="Sessions">
        <Show
          when={projection().roots.length > 0}
          fallback={
            <p class="shell-session-no-match">No sessions match “{props.query?.trim()}”.</p>
          }
        >
          <For each={projection().groups}>
            {(group) => (
              <section
                class="shell-session-group"
                aria-labelledby={`shell-session-group-${group.id}`}
              >
                <h2 id={`shell-session-group-${group.id}`}>{group.label}</h2>
                <div class="shell-session-group-tree">{renderSessions(group.roots)}</div>
              </section>
            )}
          </For>
        </Show>
      </nav>
    </ScrollView>
  );
}
