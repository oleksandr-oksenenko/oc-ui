import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
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
  readonly showHeader?: boolean;
  readonly autoFocusClose?: boolean;
  readonly serverName: string;
  readonly serverStatus: SessionSidebarStatus;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onCreate: () => void;
  readonly onRetry: () => void;
  readonly onHide?: () => void;
  readonly onSelectServer: () => void;
};

const statusLabel = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Connection failed",
} satisfies Record<SessionSidebarStatus, string>;

export function SessionSidebar(props: SessionSidebarProps) {
  return (
    <aside class="shell-session-sidebar" aria-label="Sessions">
      <Show when={props.showHeader !== false}>
        <SessionHeader
          canCreate={props.canCreate}
          autoFocusClose={props.autoFocusClose}
          onCreate={props.onCreate}
          onHide={props.onHide}
        />
      </Show>

      <Show when={props.error}>
        {(error) => (
          <div class="shell-sidebar-message" role="alert">
            <p>{error()}</p>
            <Button
              class="shell-sidebar-action"
              type="button"
              size="small"
              variant="ghost-muted"
              onClick={props.onRetry}
            >
              Retry
            </Button>
          </div>
        )}
      </Show>

      <Show when={props.loading && props.nodes.length === 0 && !props.error}>
        <output class="shell-sidebar-message shell-sidebar-loading">
          <Loader width={16} height={16} />
          <span>Loading sessions</span>
        </output>
      </Show>

      <Show when={!props.loading && !props.error && props.nodes.length === 0}>
        <div class="shell-sidebar-message">
          <p>No sessions yet.</p>
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
        <Button
          class="shell-server-selector"
          type="button"
          size="small"
          variant="ghost-muted"
          aria-label={`Select server, ${props.serverName}, ${statusLabel[props.serverStatus]}`}
          title="Select server"
          onClick={props.onSelectServer}
        >
          <span
            class={`shell-server-status ${props.serverStatus}`}
            aria-label={statusLabel[props.serverStatus]}
          >
            {props.serverStatus === "connected" ? (
              <span class="shell-server-status-dot" aria-hidden="true" />
            ) : props.serverStatus === "reconnecting" ? (
              <Loader class="shell-server-status-spinner" width={14} height={14} />
            ) : (
              <Icon name="warning" />
            )}
          </span>
          <span class="shell-server-name">{props.serverName}</span>
          <Icon class="shell-server-chevron" name="chevron-down" size="small" />
        </Button>
      </div>
    </aside>
  );
}
