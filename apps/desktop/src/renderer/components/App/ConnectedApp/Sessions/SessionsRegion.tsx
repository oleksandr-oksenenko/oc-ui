import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";

import { SessionSidebar } from "./SessionSidebar.tsx";
import type { SessionWorkspace } from "./createSessionWorkspace.ts";
import type { SessionFlows } from "./createSessionFlows.ts";

export type SessionsRegionProps = {
  readonly runtime: ConnectedRuntime;
  readonly workspace: SessionWorkspace;
  readonly flows: SessionFlows;
  readonly serverUrl: string;
  readonly mobile: boolean;
  readonly onHide?: () => void;
  readonly onSessionOpened: (sessionID: string) => void;
  readonly onChangeServer: () => void;
};

/** Renders the controlled session sidebar. */
export function SessionsRegion(props: SessionsRegionProps) {
  const connected = () => props.runtime.stream.status() === "connected";

  return (
    <SessionSidebar
      sessions={props.workspace.sessions()}
      statusForSession={(sessionID) => props.runtime.data.session.status(sessionID)}
      selectedID={props.workspace.selectedID()}
      expandedIDs={props.flows.expandedIDs()}
      loading={props.runtime.sessions.state() === "loading"}
      error={props.runtime.sessions.error()}
      canCreate={connected() && props.runtime.sessions.state() === "ready"}
      canDelete={connected() && props.runtime.sessions.state() === "ready"}
      deletionStatusForSession={props.flows.deletionStatusForSession}
      autoFocusClose={props.mobile}
      serverName={friendlyServerName(props.serverUrl)}
      serverStatus={connected() ? "connected" : "reconnecting"}
      onSelect={(sessionID) => {
        if (!connected()) return;
        props.workspace.select(sessionID);
        props.onSessionOpened(sessionID);
      }}
      onToggleExpanded={props.flows.toggleExpanded}
      onDelete={(sessionID, opener) =>
        props.flows.openSessionDeletion(sessionID, opener, resolveDeletionFocusFallback)
      }
      onCreate={props.flows.openNewSession}
      onRetry={() => void props.workspace.retryCatalog().catch(() => undefined)}
      onHide={props.onHide}
      onSelectServer={props.onChangeServer}
    />
  );
}

function resolveDeletionFocusFallback(): HTMLElement | undefined {
  const sidebar = document.querySelector<HTMLElement>('[aria-label="Sessions"]');
  return (
    sidebar?.querySelector<HTMLElement>('.shell-session-main[aria-current="page"]') ??
    sidebar?.querySelector<HTMLElement>(".shell-create-session:not(:disabled)") ??
    sidebar?.querySelector<HTMLElement>(".shell-server-selector") ??
    undefined
  );
}

function friendlyServerName(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) {
      return "Local server";
    }
    return url.hostname;
  } catch {
    return serverUrl;
  }
}
