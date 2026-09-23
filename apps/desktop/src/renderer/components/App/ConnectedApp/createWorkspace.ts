import { createComposerCatalog } from "./Conversation/createComposerCatalog.ts";
import type { BrowserApi } from "../../../../shared/browser-api.ts";
import { createSessionBrowser } from "./Browser/createSessionBrowser.ts";
import { useAtomValue } from "@effect/atom-solid";
import { Atom } from "effect/unstable/reactivity";

import { createAnnotationDraftStore } from "../../../domain/annotation-drafts.ts";
import { createReviewDraftStore } from "../../../domain/index.ts";
import { createModelSelection } from "../../../opencode/index.ts";
import type { ConnectedRuntime } from "../../../opencode/runtime.ts";
import { createWorkspaceChanges } from "./Changes/createWorkspaceChanges.ts";
import { createSessionAgentSelection } from "./Conversation/createSessionAgentSelection.ts";
import { createSessionInbox } from "./Conversation/createSessionInbox.ts";
import { createSessionComposer } from "./Conversation/createSessionComposer.ts";
import { createSessionForms } from "./Conversation/createSessionForms.ts";
import { createPermissions } from "./Permissions/createPermissions.ts";
import { createGlobalForms } from "./GlobalForms/createGlobalForms.ts";
import { createReviewFlow } from "./Review/ReviewRegion.tsx";
import { createSessionFlows } from "./Sessions/createSessionFlows.ts";
import { createSessionAttention } from "./Sessions/createSessionAttention.ts";
import { createSessionWorkspace } from "./Sessions/createSessionWorkspace.ts";
import { createShellPanelState } from "./Shell/createShellPanelState.ts";
import { createSessionPanelLayouts } from "./Shell/sessionPanelLayouts.ts";
import { createConnectedLifecycle } from "./createConnectedLifecycle.ts";

/** Construct once in the workspace's retained Solid root, independently of views. */
export function createWorkspaceModel(
  runtime: ConnectedRuntime,
  browserConnection?: { api: BrowserApi; serverUrl: string; password: string },
) {
  const connected = () => runtime.stream.status() === "connected";
  const globalForms = createGlobalForms({
    effects: runtime.effects,
    runtime,
    connected,
    location: runtime.defaultLocation,
  });
  const bootstrapState = Atom.make(false);
  runtime.effects.mount(bootstrapState);
  const bootstrapped = useAtomValue(() => bootstrapState);
  const reviewDrafts = createReviewDraftStore(runtime.effects);
  const annotationDrafts = createAnnotationDraftStore(runtime.effects);
  const reviewFlow = createReviewFlow();

  const sessions = createSessionWorkspace({
    effects: runtime.effects,
    runtime,
    connected,
    bootstrapped,
  });
  const layouts = createSessionPanelLayouts({ effects: runtime.effects });
  const panels = createShellPanelState({
    leftSidebarOpen: true,
    selectedID: sessions.selectedID,
    layouts,
  });
  const attentionForSession = createSessionAttention({
    listLocations: runtime.api.debug.location.list,
    sessionIDs: runtime.sessions.ids,
    connected,
    effects: runtime.effects,
    data: runtime.data,
    selectedID: sessions.selectedID,
  });
  const browser = createSessionBrowser(
    runtime,
    browserConnection?.api,
    browserConnection ?? { serverUrl: "", password: "" },
    sessions.selectedID,
    () => panels.rightPanelOpen() && panels.contextView() === "browser",
    (handler) => {
      const stopDeleted = runtime.data.on("session.deleted", (event) =>
        handler(event.data.sessionID),
      );
      const stopMoved = runtime.data.on("session.moved", (event) => handler(event.data.sessionID));
      return () => {
        stopDeleted();
        stopMoved();
      };
    },
    (id) => {
      sessions.select(id);
      panels.setContextView("browser");
      panels.setRightPanelOpen(true);
    },
    (id, text, files) => composer.appendBatch(id, text, files),
  );
  const modelSelection = createModelSelection({
    effects: runtime.effects,
    api: runtime.api,
    data: runtime.data,
    defaultLocation: runtime.defaultLocation,
    selectedSession: sessions.selectedSession,
  });
  const agentSelection = createSessionAgentSelection({
    effects: runtime.effects,
    api: runtime.api,
    data: runtime.data,
    selectedSession: sessions.selectedSession,
    connected,
  });
  const forms = createSessionForms({
    effects: runtime.effects,
    data: runtime.data,
    selectedID: sessions.selectedID,
    connected,
  });
  const permissions = createPermissions({
    effects: runtime.effects,
    data: runtime.data,
    selectedID: sessions.selectedID,
    connected,
  });
  createConnectedLifecycle({
    effects: runtime.effects,
    runtime,
    bootstrapped,
    markBootstrapped: () => runtime.effects.registry.set(bootstrapState, true),
    connected,
    sessions,
    syncSelectedFeatures: () =>
      Promise.allSettled([modelSelection.sync(), agentSelection.sync()]).then(() => undefined),
  });

  const changes = createWorkspaceChanges({
    effects: runtime.effects,
    runtime,
    selectedSession: sessions.selectedSession,
    bootstrapped,
    connected,
    panelOpen: panels.rightPanelOpen,
    reviewDrafts,
    requestRemoveComment: (key, commentID, opener) => {
      reviewFlow.confirmRemoval({
        title: "Delete review comment?",
        description: "This review comment will be permanently deleted.",
        confirmLabel: "Delete comment",
        focusTarget: opener,
        onConfirm: () => reviewDrafts.remove(key, commentID),
      });
    },
  });
  const inbox = createSessionInbox({
    effects: runtime.effects,
    data: runtime.data,
    api: runtime.api,
    reads: runtime.reads,
    selectedID: sessions.selectedID,
    connected,
  });
  const catalog = createComposerCatalog({
    effects: runtime.effects,
    sources: {
      commands: runtime.data.location.command,
      skills: runtime.data.location.skill,
    },
    location: () => sessions.selectedSession()?.location,
    connected,
  });
  const composer = createSessionComposer({
    effects: runtime.effects,
    runtime,
    commands: () => catalog.commands,
    selectedID: sessions.selectedID,
    transcriptLoading: sessions.transcriptLoading,
    transcriptError: sessions.transcriptError,
    annotations: annotationDrafts,
    connected,
    selectionSwitching: () => modelSelection.switching() || agentSelection.switching(),
    review: {
      drafts: reviewDrafts,
      key: changes.reviewKey,
      requestDiscard: (key, count, opener) => {
        reviewFlow.confirmRemoval({
          title: "Discard code review?",
          description: `${count} review ${count === 1 ? "comment" : "comments"} will be permanently deleted.`,
          confirmLabel: "Discard review",
          focusTarget: opener,
          onConfirm: () => reviewDrafts.clear(key),
        });
      },
    },
  });
  const flows = createSessionFlows({
    runtime,
    connected,
    workspace: sessions,
    clearDraft: composer.clear,
    onSessionCreated: (sessionID) => {
      sessions.markCreated(sessionID);
      if (panels.mobile()) panels.setLeftSidebarOpen(false);
    },
  });

  return {
    attentionForSession,
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
  };
}
export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;
