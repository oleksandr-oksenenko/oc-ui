import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { Show } from "solid-js";

import { DeleteSessionFlow } from "./SessionSidebar/DeleteSessionFlow.tsx";
import { NewSessionFlow } from "./SessionSidebar/NewSessionFlow.tsx";
import type { SessionFlows } from "./createSessionFlows.ts";

export type SessionFlowsRegionProps = {
  readonly runtime: ConnectedRuntime;
  readonly flows: SessionFlows;
  readonly onSessionCreated: (sessionID: string) => void;
  readonly onSessionOpened: (sessionID: string) => void;
};

/** Keeps modal flows mounted outside Workspace's conditionally mounted sidebar. */
export function SessionFlowsRegion(props: SessionFlowsRegionProps) {
  return (
    <>
      <Show when={props.flows.newSessionOpen()}>
        <NewSessionFlow
          runtime={props.runtime}
          onDismiss={props.flows.dismissNewSession}
          onSessionCreated={(sessionID) => {
            props.onSessionCreated(sessionID);
            props.onSessionOpened(sessionID);
          }}
        />
      </Show>

      <Show when={props.flows.deletion()}>
        {(current) => (
          <DeleteSessionFlow
            session={current().session}
            subtreeIDs={current().subtreeIDs}
            subtreeSessions={current().subtreeSessions}
            sessions={props.flows.sessions}
            sessionIDs={props.flows.sessionIDs}
            syncCatalog={props.flows.syncCatalog}
            listWorktrees={props.runtime.api.worktree.list}
            removeSession={props.runtime.api.session.remove}
            removeWorktree={props.runtime.api.worktree.remove}
            deletionStatusForSession={props.flows.deletionStatusForSession}
            onDeleted={props.flows.deleteSessions}
            onDismiss={props.flows.dismissDeletion}
          />
        )}
      </Show>
    </>
  );
}
