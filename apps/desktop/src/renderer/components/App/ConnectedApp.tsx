import { Show } from "solid-js";

import { useServerRuntime, type VerifiedServer } from "../../opencode/index.ts";
import { ChangesRegion } from "./ConnectedApp/Changes/ChangesRegion.tsx";
import { ChangesTitlebarRegion } from "./ConnectedApp/Changes/ChangesTitlebarRegion.tsx";
import { ConversationRegion } from "./ConnectedApp/Conversation/ConversationRegion.tsx";
import { GlobalFormsRegion } from "./ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { ReviewRegion } from "./ConnectedApp/Review/ReviewRegion.tsx";
import { SessionFlowsRegion } from "./ConnectedApp/Sessions/SessionFlowsRegion.tsx";
import { SessionsRegion } from "./ConnectedApp/Sessions/SessionsRegion.tsx";
import { ShellRegion } from "./ConnectedApp/Shell/ShellRegion.tsx";
import type { WorkspaceModel } from "./ConnectedApp/createWorkspace.ts";

export type ConnectedAppProps = {
  readonly server: VerifiedServer;
  readonly model: WorkspaceModel;
  readonly onChangeServer: () => void;
};

/** Renders the model retained by the connection's workspace. */
export function ConnectedApp(props: ConnectedAppProps) {
  const runtime = useServerRuntime();
  const {
    panels,
    connected,
    globalForms,
    annotationDrafts,
    reviewFlow,
    sessions,
    modelSelection,
    agentSelection,
    forms,
    permissions,
    changes,
    composer,
    flows,
  } = props.model;

  const closeLeftSidebarOnMobile = (): void => {
    if (panels.mobile()) panels.setLeftSidebarOpen(false);
  };
  const closeRightPanel = (): void => panels.setRightPanelOpen(false);
  const changesTabsId = "connected-workspace-context";

  return (
    <>
      <ShellRegion
        panels={panels}
        selectedTitle={() =>
          sessions.selectedID()
            ? sessions.selectedSession()?.title?.trim() || "Untitled session"
            : undefined
        }
        globalControls={<GlobalFormsRegion controller={globalForms} />}
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
            annotationDrafts={annotationDrafts}
            modelSelection={modelSelection}
            agentSelection={agentSelection}
            forms={forms}
            permissions={permissions}
            connected={connected}
          />
        }
        context={
          <ChangesRegion
            idBase={changesTabsId}
            changes={changes.view()}
            showTabs={panels.mobile()}
            onClose={closeRightPanel}
          />
        }
      />
      <SessionFlowsRegion flows={flows} />
      <Show when={reviewFlow.removal()}>
        <ReviewRegion flow={reviewFlow} />
      </Show>
    </>
  );
}
