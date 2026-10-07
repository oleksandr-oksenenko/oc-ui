import type { SessionAttention } from "../createSessionAttention.ts";
import type { SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { Collapsible } from "@opencode/ui/collapsible";
import { For, Show, createComputed, createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { rollupSessionAttention, type SessionAttentionState } from "../session-attention-rollup.ts";
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
  readonly sidebarVisible?: boolean;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

export function SessionTree(props: SessionTreeProps) {
  const [collapsedGroups, setCollapsedGroups] = createSignal<readonly string[]>([]);
  let tree: HTMLElement | undefined;
  let focusedControl: HTMLElement | undefined;
  const isExpanded = (id: string) => props.expandedIDs.includes(id);
  const query = createMemo(() => props.query?.trim().toLowerCase() ?? "");
  const projection = createMemo(() =>
    projectSessionTree(
      props.sessions,
      query(),
      props.now,
      (id) => props.statusForSession(id) === "running",
    ),
  );
  // Moving an existing row can blur its control even when its identity is preserved.
  createComputed(() => {
    projection();
    const active = document.activeElement;
    focusedControl = active instanceof HTMLElement && tree?.contains(active) ? active : undefined;
  });
  createEffect(() => {
    projection();
    if (focusedControl?.isConnected && document.activeElement === document.body) {
      focusedControl.focus({ preventScroll: true });
    }
  });
  // Attention covers the unfiltered tree so search cannot hide a blocked descendant.
  const fullProjection = createMemo(() => projectSessionTree(props.sessions, "", props.now));
  const attentionByID = createMemo<ReadonlyMap<string, SessionAttentionState>>(() => {
    const own = props.attentionForSession;
    return own === undefined ? new Map() : rollupSessionAttention(fullProjection().roots, own);
  });

  const renderSessions = (nodes: Accessor<readonly SessionTreeNode[]>) => {
    const nodesByID = createMemo(() => new Map(nodes().map((node) => [node.session.id, node])));
    return (
      <For each={[...nodesByID().keys()]}>
        {(id) => (
          <Show when={nodesByID().get(id)}>
            {(node) => {
              const session = () => node().session;
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
                  attention={attentionByID().get(session().id)}
                  hasChildren={node().children.length > 0}
                  selected={props.selectedID === session().id}
                  expanded={filtering() || isExpanded(session().id)}
                  deleteDisabled={deleteDisabledReason() !== undefined}
                  deleteDisabledReason={deleteDisabledReason()}
                  sidebarVisible={props.sidebarVisible}
                  onSelect={props.onSelect}
                  onToggleExpanded={(sessionID) => {
                    if (!filtering()) props.onToggleExpanded(sessionID);
                  }}
                  onDelete={props.onDelete}
                >
                  {node().children.length > 0 ? (
                    <div class="shell-session-children">
                      {renderSessions(() => node().children)}
                    </div>
                  ) : null}
                </SessionTreeItem>
              );
            }}
          </Show>
        )}
      </For>
    );
  };

  return (
    <nav
      ref={(element) => {
        tree = element;
      }}
      class="shell-session-tree-content"
      aria-label="Sessions"
    >
      <Show
        when={projection().roots.length > 0}
        fallback={<p class="shell-session-no-match">No sessions match “{props.query?.trim()}”.</p>}
      >
        <For each={projection().groups.map((group) => group.id)}>
          {(id) => {
            const group = () => projection().groups.find((candidate) => candidate.id === id);
            return (
              <section class="shell-session-group" aria-labelledby={`shell-session-group-${id}`}>
                <Collapsible
                  variant="ghost"
                  open={query().length > 0 || !collapsedGroups().includes(id)}
                  onOpenChange={(open) => {
                    if (query().length > 0) return;
                    setCollapsedGroups((current) =>
                      open ? current.filter((candidate) => candidate !== id) : [...current, id],
                    );
                  }}
                >
                  <h2 id={`shell-session-group-${id}`}>
                    <Collapsible.Trigger
                      class="shell-session-group-toggle oc-focus-inset"
                      type="button"
                      disabled={query().length > 0}
                    >
                      <span>{group()?.label}</span>
                      <Collapsible.Arrow aria-hidden="true" />
                    </Collapsible.Trigger>
                  </h2>
                  <Collapsible.Content class="shell-session-group-tree">
                    {renderSessions(() => group()?.roots ?? [])}
                  </Collapsible.Content>
                </Collapsible>
              </section>
            );
          }}
        </For>
      </Show>
    </nav>
  );
}
