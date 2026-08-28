import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { Show } from "solid-js";

import { SessionHeader } from "./SessionSidebar/SessionHeader.tsx";
import { SessionTree } from "./SessionSidebar/SessionTree.tsx";
import "./SessionSidebar.css";

type SessionSidebarStatus = "connected" | "reconnecting" | "failed";

export type SessionSidebarProps = {
  readonly sessions: readonly SessionInfo[];
  readonly statusForSession: (sessionID: string) => DataSessionStatus;
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly loading: boolean;
  readonly error?: string;
  readonly canCreate: boolean;
  readonly canDelete: boolean;
  readonly showHeader?: boolean;
  readonly autoFocusClose?: boolean;
  readonly serverName: string;
  readonly serverStatus: SessionSidebarStatus;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
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

      <Show when={props.loading && props.sessions.length === 0 && !props.error}>
        <output class="shell-sidebar-message shell-sidebar-loading">
          <Loader width={16} height={16} />
          <span>Loading sessions</span>
        </output>
      </Show>

      <Show when={!props.loading && !props.error && props.sessions.length === 0}>
        <div class="shell-sidebar-message">
          <p>No sessions yet.</p>
        </div>
      </Show>

      <Show when={props.sessions.length > 0 && !props.error}>
        <SessionTree
          sessions={props.sessions}
          statusForSession={props.statusForSession}
          selectedID={props.selectedID}
          expandedIDs={props.expandedIDs}
          canDelete={props.canDelete}
          onSelect={props.onSelect}
          onToggleExpanded={props.onToggleExpanded}
          onDelete={props.onDelete}
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
