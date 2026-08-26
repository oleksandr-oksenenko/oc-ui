import {
  IconAlertCircle,
  IconChevronDown,
  IconCircleFilled,
  IconLoader2,
} from "@tabler/icons-solidjs";
import { Show } from "solid-js";

import { SessionHeader } from "./SessionSidebar/SessionHeader.tsx";
import type { SessionNode } from "./SessionSidebar/SessionTree.tsx";
import { SessionTree } from "./SessionSidebar/SessionTree.tsx";
import "./SessionSidebar.css";

export type { SessionNode } from "./SessionSidebar/SessionTree.tsx";

type SessionSidebarStatus = "connected" | "reconnecting" | "failed";

export type SessionSidebarProps = {
  readonly nodes: readonly SessionNode[];
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly loading: boolean;
  readonly error?: string;
  readonly canCreate: boolean;
  readonly creating: boolean;
  readonly showHeader?: boolean;
  readonly serverName: string;
  readonly serverStatus: SessionSidebarStatus;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onCreate: () => void;
  readonly onRetry: () => void;
  readonly onHide: () => void;
  readonly onSelectServer: () => void;
};

const statusLabel: Record<SessionSidebarStatus, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection failed",
};

export function SessionSidebar(props: SessionSidebarProps) {
  return (
    <aside class="shell-session-sidebar" aria-label="Sessions">
      <Show when={props.showHeader !== false}>
        <SessionHeader
          canCreate={props.canCreate}
          creating={props.creating}
          onCreate={props.onCreate}
          onHide={props.onHide}
        />
      </Show>

      <Show when={props.error}>
        {(error) => (
          <div class="shell-sidebar-message" role="alert">
            <p>{error()}</p>
            <button class="shell-sidebar-action" type="button" onClick={props.onRetry}>
              Retry
            </button>
          </div>
        )}
      </Show>

      <Show when={props.loading && props.nodes.length === 0 && !props.error}>
        <output class="shell-sidebar-message shell-sidebar-loading">
          <IconLoader2 class="shell-spin" size={16} stroke="1.8" aria-hidden="true" />
          <span>Loading sessions</span>
        </output>
      </Show>

      <Show when={!props.loading && !props.error && props.nodes.length === 0}>
        <div class="shell-sidebar-message">
          <p>No sessions in this directory yet.</p>
        </div>
      </Show>

      <Show when={props.nodes.length > 0 && !props.error}>
        <SessionTree
          nodes={props.nodes}
          selectedID={props.selectedID}
          expandedIDs={props.expandedIDs}
          onSelect={props.onSelect}
          onToggleExpanded={props.onToggleExpanded}
        />
      </Show>

      <div class="shell-sidebar-footer">
        <button
          class="shell-server-selector"
          type="button"
          aria-label={`Select server, ${props.serverName}, ${statusLabel[props.serverStatus]}`}
          title="Select server"
          onClick={props.onSelectServer}
        >
          <span
            class={`shell-server-status ${props.serverStatus}`}
            aria-label={statusLabel[props.serverStatus]}
          >
            {props.serverStatus === "connected" ? (
              <IconCircleFilled class="shell-server-status-dot" size={6} aria-hidden="true" />
            ) : props.serverStatus === "reconnecting" ? (
              <IconLoader2
                class="shell-server-status-spinner"
                size={14}
                stroke="1.8"
                aria-hidden="true"
              />
            ) : (
              <IconAlertCircle size={14} stroke="1.8" aria-hidden="true" />
            )}
          </span>
          <span class="shell-server-name">{props.serverName}</span>
          <IconChevronDown class="shell-server-chevron" size={13} stroke="1.8" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
