import { createSignal } from "solid-js";

import {
  createModelSelection,
  useServerRuntime,
  type VerifiedServer,
} from "../../opencode/index.ts";
import { ChangesRegion } from "./ConnectedApp/Changes/ChangesRegion.tsx";
import { ChangesTitlebarRegion } from "./ConnectedApp/Changes/ChangesTitlebarRegion.tsx";
import { createWorkspaceChanges } from "./ConnectedApp/Changes/createWorkspaceChanges.ts";
import { ConversationRegion } from "./ConnectedApp/Conversation/ConversationRegion.tsx";
import { createSessionAgentSelection } from "./ConnectedApp/Conversation/createSessionAgentSelection.ts";
import { createSessionComposer } from "./ConnectedApp/Conversation/createSessionComposer.ts";
import { SessionFlowsRegion } from "./ConnectedApp/Sessions/SessionFlowsRegion.tsx";
import { SessionsRegion } from "./ConnectedApp/Sessions/SessionsRegion.tsx";
import { createSessionFlows } from "./ConnectedApp/Sessions/createSessionFlows.ts";
import { createSessionWorkspace } from "./ConnectedApp/Sessions/createSessionWorkspace.ts";
import { ShellRegion } from "./ConnectedApp/Shell/ShellRegion.tsx";
import { createShellPanelState } from "./ConnectedApp/Shell/createShellPanelState.ts";
import { createConnectedLifecycle } from "./ConnectedApp/createConnectedLifecycle.ts";

export type ConnectedAppProps = {
  readonly server: VerifiedServer;
  readonly onConnected: () => void;
  readonly onInitialFailure: (cause: unknown) => void;
  readonly onChangeServer: () => void;
};

/** Composes the connected workspace from feature-owned controllers and regions. */
export function ConnectedApp(props: ConnectedAppProps) {
  const runtime = useServerRuntime();
  const panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const connected = () => runtime.stream.status() === "connected";
  const [bootstrapped, setBootstrapped] = createSignal(false);

  const sessions = createSessionWorkspace({
    runtime,
    connected,
    bootstrapped,
  });
  const modelSelection = createModelSelection({
    api: runtime.api,
    data: runtime.data,
    defaultLocation: runtime.defaultLocation,
    selectedSession: sessions.selectedSession,
  });
  const agentSelection = createSessionAgentSelection({
    api: runtime.api,
    data: runtime.data,
    selectedSession: sessions.selectedSession,
    connected,
  });
  createConnectedLifecycle({
    runtime,
    bootstrapped,
    markBootstrapped: () => setBootstrapped(true),
    connected,
    sessions,
    syncSelections: () =>
      Promise.all([
        modelSelection.sync().catch(() => undefined),
        agentSelection.sync().catch(() => undefined),
      ]).then(() => undefined),
    onConnected: props.onConnected,
    onInitialFailure: props.onInitialFailure,
  });

  const composer = createSessionComposer({
    runtime,
    selectedID: sessions.selectedID,
    running: sessions.running,
    transcriptLoading: sessions.transcriptLoading,
    connected,
    selectionSwitching: () => modelSelection.switching() || agentSelection.switching(),
  });
  const flows = createSessionFlows({
    runtime,
    connected,
    workspace: sessions,
    clearDraft: composer.clear,
  });
  const changes = createWorkspaceChanges({
    runtime,
    selectedSession: sessions.selectedSession,
    bootstrapped,
    connected,
    panelOpen: panels.rightPanelOpen,
  });

  const closeLeftSidebarOnMobile = (): void => {
    if (panels.mobile()) panels.setLeftSidebarOpen(false);
  };
  const closeRightPanel = (): void => panels.setRightPanelOpen(false);
  const changesTabsId = "connected-workspace-context";

  return (
    <>
      <ShellRegion
        panels={panels}
        selectedTitle={() => sessions.selectedSession()?.title}
        rightControls={<ChangesTitlebarRegion onClose={closeRightPanel} />}
        sidebar={
          <SessionsRegion
            runtime={runtime}
            workspace={sessions}
            flows={flows}
            serverUrl={props.server.serverUrl}
            mobile={panels.mobile()}
            onHide={panels.mobile() ? closeLeftSidebarOnMobile : undefined}
            onSessionOpened={closeLeftSidebarOnMobile}
            onChangeServer={props.onChangeServer}
          />
        }
        main={
          <ConversationRegion
            workspace={sessions}
            composer={composer}
            modelSelection={modelSelection}
            agentSelection={agentSelection}
            connected={connected}
          />
        }
        context={
          <ChangesRegion
            idBase={changesTabsId}
            changes={changes()}
            showTabs={panels.mobile()}
            onClose={closeRightPanel}
          />
        }
      />
      <SessionFlowsRegion
        runtime={runtime}
        flows={flows}
        onSessionCreated={sessions.markCreated}
        onSessionOpened={closeLeftSidebarOnMobile}
      />
    </>
  );
}
