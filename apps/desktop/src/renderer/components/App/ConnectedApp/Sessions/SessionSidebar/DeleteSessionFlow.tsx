import type {
  OpenCodeClient,
  SessionInfo,
  WorktreeDirectory,
  WorktreeRemoveInput,
} from "@opencode-ai/client";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { showToast } from "@opencode-ai/ui/toast";
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

import { useServerFlowDismissBlock } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import { sessionSubtreeIDs } from "../session-selection.ts";
import type { SessionDeletionStatus } from "../createSessionFlows.ts";
import { DeleteSessionDialog } from "./DeleteSessionFlow/DeleteSessionDialog.tsx";

type CleanupPlan = {
  readonly candidates: readonly WorktreeRemoveInput[];
  readonly retainedPaths: readonly string[];
};

export type DeleteSessionFlowProps = {
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

export function DeleteSessionFlow(props: DeleteSessionFlowProps) {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let activeDialog = dialog.active;
  let closingFlow = false;
  const ownsDialog = (): boolean => !closingFlow && dialog.active === activeDialog;

  const title = () => props.session.title?.trim() || "Untitled session";

  const deleteSession = async (): Promise<void> => {
    if (deleting()) return;

    setDeleting(true);
    if (ownsDialog()) setDismissBlocked(true);
    setError(undefined);
    let sessionRemoved = false;
    let subtreeIDs = props.subtreeIDs;
    let cleanup: CleanupPlan = { candidates: [], retainedPaths: [] };

    try {
      try {
        await props.syncCatalog();
      } catch {
        setError("The session catalog could not be refreshed. Retry before deleting.");
        return;
      }

      const currentSessions = props.sessions();
      if (
        props
          .sessionIDs()
          .some((sessionID) => !currentSessions.some((session) => session.id === sessionID))
      ) {
        setError("The session records could not be fully loaded. Retry before deleting.");
        return;
      }
      const status = props.deletionStatusForSession(props.session.id);
      if (status === "running") {
        setError("Wait for this session and its child sessions to finish before deleting.");
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
      cleanup = await collectInitialCleanup({
        sessions: target.subtreeSessions,
        listWorktrees: props.listWorktrees,
      });

      if (!ownsDialog()) return;
      if (!sessionRemoved) {
        if (props.deletionStatusForSession(props.session.id) === "running") {
          setError("Wait for this session and its child sessions to finish before deleting.");
          return;
        }
        await props.removeSession({ sessionID: props.session.id });
        sessionRemoved = true;
      }

      // Keep the catalog and selection responsive while cleanup performs more server reads.
      props.onDeleted(subtreeIDs);
      if (!ownsDialog()) {
        notifyRetained([
          ...cleanup.retainedPaths,
          ...cleanup.candidates.map((candidate) => candidate.directory),
        ]);
        return;
      }

      let remainingCleanup: CleanupPlan;
      try {
        await props.syncCatalog();
        if (
          props
            .sessionIDs()
            .some((sessionID) => !props.sessions().some((session) => session.id === sessionID))
        ) {
          throw new Error("The session records could not be fully loaded.");
        }
        remainingCleanup = {
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
          retainedPaths: [],
        };
      } catch {
        remainingCleanup = {
          candidates: [],
          retainedPaths: cleanup.candidates.map((candidate) => candidate.directory),
        };
      }

      const retainedPaths = new Set([...cleanup.retainedPaths, ...remainingCleanup.retainedPaths]);
      for (const candidate of remainingCleanup.candidates) {
        if (!ownsDialog()) {
          retainedPaths.add(candidate.directory);
          continue;
        }
        try {
          await props.removeWorktree(candidate);
        } catch {
          retainedPaths.add(candidate.directory);
        }
      }

      if (retainedPaths.size > 0) {
        notifyRetained([...retainedPaths]);
      }
      if (!ownsDialog()) return;
      setDismissBlocked(false);
      dialog.close();
    } catch {
      if (!sessionRemoved) {
        setError("The session could not be deleted. Check the connection and try again.");
      }
    } finally {
      setDeleting(false);
      if (ownsDialog()) setDismissBlocked(false);
    }
  };

  onMount(() => {
    const shown = dialog.show(
      () => (
        <DeleteSessionDialog
          title={title()}
          descendantCount={props.subtreeIDs.length - 1}
          deleting={deleting()}
          error={error()}
          onDelete={() => void deleteSession()}
        />
      ),
      () => {
        queueMicrotask(() => {
          if (!closingFlow) props.onDismiss();
        });
      },
    );
    queueMicrotask(() => {
      if (!closingFlow) activeDialog = dialog.active;
    });
    void shown.then(() => {
      if (closingFlow && dialog.active === activeDialog) dialog.close();
      return undefined;
    });
  });

  onCleanup(() => {
    closingFlow = true;
    if (dialog.active !== activeDialog) return;
    setDismissBlocked(false);
    dialog.close();
  });

  return null;
}

function notifyRetained(paths: readonly string[]): void {
  const uniquePaths = [...new Set(paths)];
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
  readonly sessions: readonly SessionInfo[];
  readonly listWorktrees: DeleteSessionFlowProps["listWorktrees"];
};

async function collectInitialCleanup(input: InitialCleanupInput): Promise<CleanupPlan> {
  const retainedPaths = new Set<string>();
  const candidates: WorktreeRemoveInput[] = [];
  const projects = new Map<string, readonly WorktreeDirectory[] | undefined>();
  for (const session of input.sessions) {
    if (session.location.workspaceID !== undefined) {
      retainedPaths.add(session.location.directory);
      continue;
    }
    if (!projects.has(session.projectID)) {
      try {
        projects.set(
          session.projectID,
          await input.listWorktrees({ projectID: session.projectID }),
        );
      } catch {
        projects.set(session.projectID, undefined);
      }
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
      projectID: session.projectID,
      directory: worktree.directory,
      force: true,
    };
    if (candidates.some((existing) => sameCandidate(existing, candidate))) continue;
    candidates.push(candidate);
  }
  return { candidates, retainedPaths: [...retainedPaths] };
}

function isWithinDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeDirectory(path);
  const normalizedDirectory = normalizeDirectory(directory);
  return (
    normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`)
  );
}

function sameCandidate(left: WorktreeRemoveInput, right: WorktreeRemoveInput): boolean {
  return left.projectID === right.projectID && sameDirectory(left.directory, right.directory);
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
