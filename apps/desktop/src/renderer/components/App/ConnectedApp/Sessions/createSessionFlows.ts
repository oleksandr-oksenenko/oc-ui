import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { createSignal, type Accessor } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import { sessionSubtreeIDs } from "./session-selection.ts";
import type { SessionWorkspace } from "./createSessionWorkspace.ts";

type SessionDeletion = {
  readonly session: SessionInfo;
  readonly subtreeIDs: readonly string[];
  readonly opener: HTMLButtonElement;
  readonly focusFallback?: SessionFocusResolver;
  readonly worktree?: { readonly projectID: string; readonly directory: string };
};

type SessionFocusResolver = () => HTMLElement | undefined;

export type SessionDeletionStatus = "ready" | "running" | "removed";

export type SessionFlowsRuntime = {
  readonly data: {
    readonly session: {
      readonly status: (sessionID: string) => DataSessionStatus;
    };
    readonly project: {
      readonly list: () => readonly {
        readonly id: string;
        readonly sandboxes: readonly string[];
      }[];
    };
  };
};

export type SessionFlowsWorkspace = Pick<SessionWorkspace, "sessions" | "remove">;

export type SessionFlows = {
  readonly expandedIDs: Accessor<readonly string[]>;
  readonly newSessionOpen: Accessor<boolean>;
  readonly deletion: Accessor<SessionDeletion | undefined>;
  readonly deletionStatusForSession: (sessionID: string) => SessionDeletionStatus;
  readonly openNewSession: () => void;
  readonly dismissNewSession: () => void;
  readonly openSessionDeletion: (
    sessionID: string,
    opener: HTMLButtonElement,
    focusFallback?: SessionFocusResolver,
  ) => void;
  readonly dismissDeletion: () => void;
  readonly deleteSessions: (sessionIDs: readonly string[]) => void;
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
  const [newSessionOpen, setNewSessionOpen] = createSignal(false);
  const [deletion, setDeletion] = createSignal<SessionDeletion>();
  let newSessionOpener: HTMLElement | undefined;

  const openNewSession = (): void => {
    newSessionOpener =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setNewSessionOpen(true);
  };

  const dismissNewSession = (): void => {
    setNewSessionOpen(false);
    restoreDialogFocusAfterClose(() => newSessionOpener);
  };

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
    if (!input.connected()) return;
    const target = inspectDeletion(sessionID);
    if (target.status !== "ready") return;
    const project = input.runtime.data.project
      .list()
      .find((candidate) => candidate.id === target.session.projectID);
    const worktreeDirectory = project?.sandboxes.find((directory) =>
      sameDirectory(directory, target.session.location.directory),
    );
    setDeletion({
      session: target.session,
      subtreeIDs: target.subtreeIDs,
      opener,
      focusFallback,
      worktree: worktreeDirectory
        ? { projectID: target.session.projectID, directory: worktreeDirectory }
        : undefined,
    });
  };

  const dismissDeletion = (): void => {
    const current = deletion();
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
    newSessionOpen,
    deletion,
    deletionStatusForSession,
    openNewSession,
    dismissNewSession,
    openSessionDeletion,
    dismissDeletion,
    deleteSessions,
    toggleExpanded,
  };
}

function sameDirectory(left: string, right: string): boolean {
  return normalizeDirectory(left) === normalizeDirectory(right);
}

const normalizeDirectory = (value: string): string =>
  value.replaceAll("\\", "/").replace(/\/+$/, "");
