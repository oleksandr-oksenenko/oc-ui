import type { SessionInfo } from "@opencode/client";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createSignal, type Accessor } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import { sessionSubtreeIDs } from "./session-selection.ts";
import {
  createDeleteSessionFlow,
  type DeleteSessionFlowController,
} from "./SessionSidebar/DeleteSessionFlow.tsx";
import type { SessionWorkspace } from "./createSessionWorkspace.ts";

type SessionDeletion = {
  readonly flow: DeleteSessionFlowController;
  readonly opener: HTMLButtonElement;
  readonly focusFallback?: SessionFocusResolver;
};

type SessionFocusResolver = () => HTMLElement | undefined;

export type SessionDeletionStatus = "ready" | "running" | "removed";

export type SessionFlowsRuntime = Pick<
  ConnectedRuntime,
  "effects" | "api" | "data" | "sessions" | "defaultLocation"
>;

export type SessionFlowsWorkspace = Pick<SessionWorkspace, "sessions" | "syncCatalog" | "remove">;

export type SessionFlows = {
  readonly expandedIDs: Accessor<readonly string[]>;
  readonly deletion: Accessor<SessionDeletion | undefined>;
  readonly deletionStatusForSession: (sessionID: string) => SessionDeletionStatus;
  readonly openSessionDeletion: (
    sessionID: string,
    opener: HTMLButtonElement,
    focusFallback?: SessionFocusResolver,
  ) => void;
  readonly dismissDeletion: () => void;
  readonly toggleExpanded: (sessionID: string) => void;
};

export type CreateSessionFlowsInput = {
  readonly runtime: SessionFlowsRuntime;
  readonly connected: Accessor<boolean>;
  readonly workspace: SessionFlowsWorkspace;
  readonly clearDraft: (sessionID: string) => void;
};

/** Owns session sidebar expansion and the modal flows opened from it. */
export function createSessionFlows(input: CreateSessionFlowsInput): SessionFlows {
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([]);
  const [deletion, setDeletion] = createSignal<SessionDeletion>();
  const inspectDeletion = (
    sessionID: string,
  ):
    | { readonly status: "removed" | "running" }
    | {
        readonly status: "ready";
        readonly session: SessionInfo;
        readonly subtreeIDs: readonly string[];
      } => {
    const sessions = input.workspace.sessions();
    const session = sessions.find((candidate) => candidate.id === sessionID);
    if (session === undefined) return { status: "removed" };
    const subtreeIDs = sessionSubtreeIDs(sessionID, sessions);
    if (
      subtreeIDs.some((candidateID) => input.runtime.data.session.status(candidateID) === "running")
    ) {
      return { status: "running" };
    }
    return { status: "ready", session, subtreeIDs };
  };

  const deletionStatusForSession = (sessionID: string): SessionDeletionStatus =>
    inspectDeletion(sessionID).status;

  const openSessionDeletion = (
    sessionID: string,
    opener: HTMLButtonElement,
    focusFallback?: SessionFocusResolver,
  ): void => {
    if (!input.connected() || deletion()) return;
    const target = inspectDeletion(sessionID);
    if (target.status !== "ready") return;
    const flow = createDeleteSessionFlow({
      effects: input.runtime.effects,
      session: target.session,
      subtreeIDs: target.subtreeIDs,
      sessions: input.workspace.sessions,
      sessionIDs: input.runtime.sessions.ids,
      syncCatalog: input.workspace.syncCatalog,
      removeSession: input.runtime.api.session.remove,
      deletionStatusForSession,
      onDeleted: deleteSessions,
      onDismiss: dismissDeletion,
    });
    setDeletion({
      flow,
      opener,
      focusFallback,
    });
  };

  const dismissDeletion = (): void => {
    const current = deletion();
    if (current?.flow.pending() && !current.flow.current().closed) return;
    current?.flow.dispose();
    setDeletion(undefined);
    restoreDialogFocusAfterClose(() => {
      if (current === undefined) return undefined;
      if (current.opener.isConnected) return current.opener;
      return current.focusFallback?.();
    });
  };

  const deleteSessions = (sessionIDs: readonly string[]): void => {
    input.workspace.remove(sessionIDs);
    for (const sessionID of sessionIDs) input.clearDraft(sessionID);
    const removed = new Set(sessionIDs);
    setExpandedIDs((current) => current.filter((id) => !removed.has(id)));
  };

  const toggleExpanded = (sessionID: string): void => {
    setExpandedIDs((current) =>
      current.includes(sessionID)
        ? current.filter((id) => id !== sessionID)
        : [...current, sessionID],
    );
  };

  return {
    expandedIDs,
    deletion,
    deletionStatusForSession,
    openSessionDeletion,
    dismissDeletion,
    toggleExpanded,
  };
}
