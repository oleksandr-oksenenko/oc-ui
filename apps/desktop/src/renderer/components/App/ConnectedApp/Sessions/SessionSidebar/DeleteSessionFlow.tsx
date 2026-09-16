import { useAtomValue } from "@effect/atom-solid";
import { Effect, Exit, Result } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../../workspace-owner.ts";
import type {
  OpenCodeClient,
  SessionInfo,
  WorktreeDirectory,
  WorktreeRemoveInput,
} from "@opencode/client";
import { useDialog } from "@opencode/ui/context/dialog";
import { showToast } from "@opencode/ui/toast";
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";

import { useServerFlowDismissBlock } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import { sessionSubtreeIDs } from "../session-selection.ts";
import type { SessionDeletionStatus } from "../createSessionFlows.ts";
import { DeleteSessionDialog } from "./DeleteSessionFlow/DeleteSessionDialog.tsx";

type CleanupPlan = {
  readonly candidates: readonly WorktreeRemoveInput[];
  readonly retainedPaths: readonly string[];
};

export type CreateDeleteSessionFlowInput = {
  readonly effects: WorkspaceOwner;
  readonly session: SessionInfo;
  readonly subtreeIDs: readonly string[];
  readonly subtreeSessions: readonly SessionInfo[];
  readonly sessions: Accessor<readonly SessionInfo[]>;
  readonly sessionIDs: () => readonly string[];
  readonly syncCatalog: () => Promise<void>;
  readonly listWorktrees: OpenCodeClient["worktree"]["list"];
  readonly removeSession: OpenCodeClient["session"]["remove"];
  readonly removeWorktree: OpenCodeClient["worktree"]["remove"];
  readonly deletionStatusForSession: (sessionID: string) => SessionDeletionStatus;
  readonly onDeleted: (sessionIDs: readonly string[]) => void;
  readonly onDismiss: () => void;
};

export function createDeleteSessionFlow(props: CreateDeleteSessionFlowInput) {
  const effects = props.effects;
  const status = Atom.make<{ deleting: boolean; error?: string; closed?: boolean }>({
    deleting: false,
  });
  const releaseStatus = effects.mount(status);
  const current = () => effects.registry.get(status);
  const update = (patch: Partial<ReturnType<typeof current>>) =>
    effects.registry.set(status, { ...effects.registry.get(status), ...patch });
  const dispose = (): void => {
    update({ closed: true });
    if (!current().deleting) releaseStatus();
  };
  const deleteSession = Effect.fn("DeleteSessionFlow.deleteSession")(function* () {
    if (current().deleting || current().closed) return;

    update({ deleting: true, error: undefined });
    let sessionRemoved = false;
    let subtreeIDs = props.subtreeIDs;
    let cleanup: CleanupPlan = { candidates: [], retainedPaths: [] };
    yield* Effect.addFinalizer((exit) =>
      Effect.sync(() => {
        if (Exit.hasInterrupts(exit) && sessionRemoved) notifyRetained(cleanup);
        update({ deleting: false });
        if (current().closed) releaseStatus();
      }),
    );

    const refreshed = yield* Effect.tryPromise(props.syncCatalog).pipe(Effect.result);
    if (Result.isFailure(refreshed)) {
      update({ error: "The session catalog could not be refreshed. Retry before deleting." });
      return;
    }

    const currentSessions = props.sessions();
    if (
      props
        .sessionIDs()
        .some((sessionID) => !currentSessions.some((session) => session.id === sessionID))
    ) {
      update({ error: "The session records could not be fully loaded. Retry before deleting." });
      return;
    }
    const deletionStatus = props.deletionStatusForSession(props.session.id);
    if (deletionStatus === "running") {
      update({
        error: "Wait for this session and its child sessions to finish before deleting.",
      });
      return;
    }

    const target = deletionTarget(
      props.session.id,
      props.subtreeIDs,
      props.subtreeSessions,
      currentSessions,
    );
    subtreeIDs = target.subtreeIDs;
    sessionRemoved = target.sessionRemoved;
    cleanup = yield* collectInitialCleanup({
      effects,
      sessions: target.subtreeSessions,
      listWorktrees: props.listWorktrees,
    });

    if (!sessionRemoved) {
      if (props.deletionStatusForSession(props.session.id) === "running") {
        update({
          error: "Wait for this session and its child sessions to finish before deleting.",
        });
        return;
      }
      const removed = yield* effects
        .request((signal) => props.removeSession({ sessionID: props.session.id }, { signal }))
        .pipe(Effect.result);
      if (Result.isFailure(removed)) {
        update({
          error: "The session could not be deleted. Check the connection and try again.",
        });
        return;
      }
      sessionRemoved = true;
    }

    // Keep the catalog and selection responsive while cleanup performs more server reads.
    props.onDeleted(subtreeIDs);

    const finalRefresh = yield* Effect.tryPromise(props.syncCatalog).pipe(Effect.result);
    if (
      Result.isFailure(finalRefresh) ||
      props
        .sessionIDs()
        .some((sessionID) => !props.sessions().some((session) => session.id === sessionID))
    ) {
      cleanup = {
        candidates: [],
        retainedPaths: [
          ...cleanup.retainedPaths,
          ...cleanup.candidates.map((candidate) => candidate.directory),
        ],
      };
    } else {
      cleanup = {
        ...cleanup,
        candidates: cleanup.candidates.filter(
          (candidate) =>
            !props
              .sessions()
              .some(
                (session) =>
                  session.location.workspaceID === undefined &&
                  isWithinDirectory(session.location.directory, candidate.directory),
              ),
        ),
      };
    }

    for (const candidate of cleanup.candidates) {
      const removed = yield* effects
        .request((signal) => props.removeWorktree(candidate, { signal }))
        .pipe(Effect.result);
      if (Result.isSuccess(removed))
        cleanup = {
          ...cleanup,
          candidates: cleanup.candidates.filter((entry) => entry !== candidate),
        };
    }

    notifyRetained(cleanup);
    update({ closed: true });
    props.onDismiss();
  }, Effect.scoped);

  return {
    dispose,
    status,
    current,
    title: props.session.title?.trim() || "Untitled session",
    descendantCount: props.subtreeIDs.length - 1,
    pending: () => current().deleting,
    delete: () => {
      effects.runFork(deleteSession());
    },
    dismiss: () => {
      if (current().deleting || current().closed) return;
      dispose();
      props.onDismiss();
    },
  };
}

export type DeleteSessionFlowController = ReturnType<typeof createDeleteSessionFlow>;
export type DeleteSessionFlowProps = { readonly flow: DeleteSessionFlowController };

export function DeleteSessionFlow(props: DeleteSessionFlowProps) {
  const flow = props.flow;
  const current = useAtomValue(() => flow.status);
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  let closingView = false;
  const onClose = () => {
    queueMicrotask(() => {
      if (!closingView) flow.dismiss();
    });
  };
  const ownsDialog = () => dialog.active?.onClose === onClose;
  createEffect(() => {
    setDismissBlocked(current().deleting);
    if (current().closed && ownsDialog()) dialog.close();
  });
  onMount(() => {
    const shown = dialog.show(
      () => (
        <DeleteSessionDialog
          title={flow.title}
          descendantCount={flow.descendantCount}
          deleting={current().deleting}
          error={current().error}
          onDelete={flow.delete}
        />
      ),
      onClose,
    );
    void shown.then(() => {
      if (closingView && ownsDialog()) dialog.close();
      return undefined;
    });
  });
  onCleanup(() => {
    closingView = true;
    if (!ownsDialog()) return;
    setDismissBlocked(false);
    dialog.close();
  });
  return null;
}

function notifyRetained(cleanup: CleanupPlan): void {
  const uniquePaths = [
    ...new Set([...cleanup.retainedPaths, ...cleanup.candidates.map(({ directory }) => directory)]),
  ];
  if (uniquePaths.length === 0) return;
  showToast({
    title: "Session deleted",
    description: `The session was deleted. Retained worktrees require manual cleanup: ${uniquePaths.join(
      ", ",
    )}`,
    persistent: true,
    variant: "error",
  });
}

type DeletionTarget = {
  readonly sessionRemoved: boolean;
  readonly subtreeIDs: readonly string[];
  readonly subtreeSessions: readonly SessionInfo[];
};

function deletionTarget(
  sessionID: string,
  capturedSubtreeIDs: readonly string[],
  capturedSubtreeSessions: readonly SessionInfo[],
  currentSessions: readonly SessionInfo[],
): DeletionTarget {
  if (!currentSessions.some((session) => session.id === sessionID)) {
    return {
      sessionRemoved: true,
      subtreeIDs: capturedSubtreeIDs,
      subtreeSessions: capturedSubtreeSessions,
    };
  }
  const subtreeIDs = sessionSubtreeIDs(sessionID, currentSessions);
  return {
    sessionRemoved: false,
    subtreeIDs,
    subtreeSessions: subtreeIDs.flatMap((subtreeID) => {
      const session = currentSessions.find((candidate) => candidate.id === subtreeID);
      return session === undefined ? [] : [session];
    }),
  };
}

type InitialCleanupInput = {
  readonly effects: WorkspaceOwner;
  readonly sessions: readonly SessionInfo[];
  readonly listWorktrees: CreateDeleteSessionFlowInput["listWorktrees"];
};

const collectInitialCleanup = Effect.fn("DeleteSessionFlow.collectInitialCleanup")(function* (
  input: InitialCleanupInput,
): Effect.fn.Return<CleanupPlan> {
  const retainedPaths = new Set<string>();
  const candidates: WorktreeRemoveInput[] = [];
  const projects = new Map<string, readonly WorktreeDirectory[] | undefined>();
  for (const session of input.sessions) {
    if (session.location.workspaceID !== undefined) {
      retainedPaths.add(session.location.directory);
      continue;
    }
    if (!projects.has(session.projectID)) {
      const listed = yield* input.effects
        .request((signal) =>
          input.listWorktrees({ location: { directory: session.location.directory } }, { signal }),
        )
        .pipe(Effect.result);
      projects.set(session.projectID, Result.isSuccess(listed) ? listed.success : undefined);
    }
    const worktrees = projects.get(session.projectID);
    if (worktrees === undefined) {
      retainedPaths.add(session.location.directory);
      continue;
    }
    // Select the closest registered root before checking its strategy, so a
    // nested primary or non-Git directory cannot select an enclosing worktree.
    const worktree = worktrees
      .filter((entry) => isWithinDirectory(session.location.directory, entry.directory))
      .toSorted((left, right) => right.directory.length - left.directory.length)[0];
    if (worktree?.strategy !== "git") continue;
    const candidate: WorktreeRemoveInput = {
      location: { directory: worktree.directory },
      directory: worktree.directory,
      force: true,
    };
    if (candidates.some((existing) => sameCandidate(existing, candidate))) continue;
    candidates.push(candidate);
  }
  return { candidates, retainedPaths: [...retainedPaths] };
});

function isWithinDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeDirectory(path);
  const normalizedDirectory = normalizeDirectory(directory);
  return (
    normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`)
  );
}

function sameCandidate(left: WorktreeRemoveInput, right: WorktreeRemoveInput): boolean {
  return sameDirectory(left.directory, right.directory);
}

function sameDirectory(left: string, right: string): boolean {
  return normalizeDirectory(left) === normalizeDirectory(right);
}

function normalizeDirectory(value: string): string {
  const windows = isWindowsDirectory(value);
  const normalized = windows ? value.replaceAll("\\", "/") : value;
  return normalized.replace(/\/+$/, "");
}

function isWindowsDirectory(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}
