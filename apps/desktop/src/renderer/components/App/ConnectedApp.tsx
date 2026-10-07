import { AddProjectRegion } from "./ConnectedApp/Sessions/AddProjectRegion.tsx";
import { NewSessionDraftRegion } from "./ConnectedApp/Conversation/NewSessionDraftRegion.tsx";
import { Show } from "solid-js";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";

import { useServerRuntime, type VerifiedServer } from "../../opencode/index.ts";
import { BrowserRegion } from "./ConnectedApp/Browser/BrowserRegion.tsx";
import { ChangesRegion } from "./ConnectedApp/Changes/ChangesRegion.tsx";
import { ContextTitlebarRegion } from "./ConnectedApp/Shell/ContextTitlebarRegion.tsx";
import { ConversationRegion } from "./ConnectedApp/Conversation/ConversationRegion.tsx";
import { GlobalFormsRegion } from "./ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { ReviewRegion } from "./ConnectedApp/Review/ReviewRegion.tsx";
import { SessionFlowsRegion } from "./ConnectedApp/Sessions/SessionFlowsRegion.tsx";
import { SessionActionsRegion } from "./ConnectedApp/Sessions/SessionActionsRegion.tsx";
import { SessionsRegion } from "./ConnectedApp/Sessions/SessionsRegion.tsx";
import { ShellRegion } from "./ConnectedApp/Shell/ShellRegion.tsx";
import type { WorkspaceModel } from "./ConnectedApp/createWorkspace.ts";
import { TerminalRegion } from "./ConnectedApp/Terminal/TerminalRegion.tsx";

export type ConnectedAppProps = {
  readonly server: VerifiedServer;
  readonly model: WorkspaceModel;
  readonly onChangeServer: () => void;
};

/** Renders the model retained by the connection's workspace. */
export function ConnectedApp(props: ConnectedAppProps) {
  const runtime = useServerRuntime();
  const {
    drafts,
    browser,
    panels,
    connected,
    globalForms,
    annotationDrafts,
    reviewFlow,
    sessions,
    modelSelection,
    agentSelection,
    catalog,
    forms,
    permissions,
    changes,
    composer,
    inbox,
    flows,
    terminals,
    terminalFonts,
    terminalPanel,
  } = props.model;

  const closeLeftSidebarOnMobile = (): void => {
    if (panels.mobile()) panels.setLeftSidebarOpen(false);
  };
  const closeRightPanel = (): void => panels.setRightPanelOpen(false);
  const changesTabsId = "connected-workspace-context";
  let terminalToggle: HTMLButtonElement | undefined;
  const hideTerminal = () => {
    terminalPanel.setOpen(false);
    terminalToggle?.focus({ preventScroll: true });
  };

  return (
    <>
      <ShellRegion
        panels={panels}
        bottomOpen={terminalPanel.open()}
        terminalControls={
          <IconButton
            ref={(element) => {
              terminalToggle = element;
            }}
            size="normal"
            variant="ghost-muted"
            icon={<Icon name="terminal" />}
            aria-label={terminalPanel.open() ? "Hide terminal panel" : "Show terminal"}
            data-terminal-focus
            title={terminalPanel.open() ? "Hide terminal panel" : "Show terminal"}
            aria-pressed={terminalPanel.open()}
            onClick={terminalPanel.toggle}
          />
        }
        bottom={
          <TerminalRegion
            controller={terminals}
            fonts={terminalFonts}
            effects={runtime.effects}
            serverUrl={props.server.serverUrl}
            location={
              sessions.selectedDraftID()
                ? undefined
                : (sessions.selectedSession()?.location ?? runtime.defaultLocation)
            }
            open={terminalPanel.open()}
            connected={connected()}
            onHide={hideTerminal}
          />
        }
        rightPanelAvailable={sessions.selectedDraftID() === undefined}
        selectedTitle={() =>
          sessions.selectedDraftID()
            ? "New session"
            : sessions.selectedID()
              ? sessions.selectedSession()?.title?.trim() || "Untitled session"
              : undefined
        }
        sidebarActions={
          <SessionActionsRegion canCreate={drafts.canCreate()} onCreate={drafts.create} />
        }
        rightControls={
          <ContextTitlebarRegion
            onClose={closeRightPanel}
            browserAvailable={browser.available}
            view={panels.contextView()}
            onViewChange={panels.setContextView}
          />
        }
        sidebar={
          <SessionsRegion
            attentionForSession={props.model.attentionForSession}
            runtime={runtime}
            workspace={sessions}
            flows={flows}
            drafts={drafts}
            globalControls={
              <GlobalFormsRegion controller={globalForms} visible={panels.leftSidebarOpen()} />
            }
            serverUrl={props.server.serverUrl}
            mobile={panels.mobile()}
            sidebarVisible={panels.leftSidebarOpen()}
            onHide={panels.mobile() ? closeLeftSidebarOnMobile : undefined}
            onSessionOpened={closeLeftSidebarOnMobile}
            onChangeServer={props.onChangeServer}
          />
        }
        main={
          <Show
            when={sessions.selectedDraftID()}
            fallback={
              <ConversationRegion
                workspace={sessions}
                composer={composer}
                inbox={inbox}
                annotationDrafts={annotationDrafts}
                modelSelection={modelSelection}
                agentSelection={agentSelection}
                catalog={catalog}
                forms={forms}
                permissions={permissions}
                connected={connected}
                canCreate={drafts.canCreate()}
                onCreate={drafts.create}
                onBrowseSessions={() => panels.setLeftSidebarOpen(true)}
              />
            }
          >
            <NewSessionDraftRegion controller={drafts} />
          </Show>
        }
        context={
          <div class="workspace-context-body">
            <Show when={panels.mobile() && browser.available}>
              <ContextTitlebarRegion
                onClose={closeRightPanel}
                autoFocusClose
                browserAvailable
                view={panels.contextView()}
                onViewChange={panels.setContextView}
              />
            </Show>
            <Show
              when={browser.available && panels.contextView() === "browser"}
              fallback={
                <ChangesRegion
                  idBase={changesTabsId}
                  files={changes.files()}
                  presentation={changes.presentation()}
                  review={changes.review()}
                  showTabs={panels.mobile() && !browser.available}
                  onClose={closeRightPanel}
                />
              }
            >
              <BrowserRegion
                controller={browser}
                sessionSelected={sessions.selectedID() !== undefined}
              />
            </Show>
          </div>
        }
      />
      <AddProjectRegion controller={drafts} runtime={runtime} />
      <SessionFlowsRegion flows={flows} />
      <Show when={reviewFlow.removal()}>
        <ReviewRegion flow={reviewFlow} />
      </Show>
    </>
  );
}
