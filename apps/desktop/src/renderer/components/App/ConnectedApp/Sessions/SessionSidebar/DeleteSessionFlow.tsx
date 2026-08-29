import type { OpenCodeClient, SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

import { useServerFlowDismissBlock } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import { DeleteSessionDialog } from "./DeleteSessionFlow/DeleteSessionDialog.tsx";

export type DeleteSessionFlowProps = {
  readonly session: SessionInfo;
  readonly subtreeIDs: readonly string[];
  readonly worktree?: { readonly projectID: string; readonly directory: string };
  readonly removeSession: OpenCodeClient["session"]["remove"];
  readonly removeWorktree: OpenCodeClient["worktree"]["remove"];
  readonly statusForSession: (sessionID: string) => DataSessionStatus;
  readonly onDeleted: (sessionIDs: readonly string[]) => void;
  readonly onDismiss: () => void;
};

export function DeleteSessionFlow(props: DeleteSessionFlowProps) {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  const [deleting, setDeleting] = createSignal(false);
  const [sessionRemoved, setSessionRemoved] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let activeDialog = dialog.active;
  let closingFlow = false;

  const title = () => props.session.title?.trim() || "Untitled session";

  const deleteSession = async (): Promise<void> => {
    if (deleting()) return;
    if (props.subtreeIDs.some((sessionID) => props.statusForSession(sessionID) === "running")) {
      setError("Wait for this session and its child sessions to finish before deleting.");
      return;
    }

    setDeleting(true);
    setError(undefined);
    let deleted = false;
    try {
      if (!sessionRemoved()) {
        await props.removeSession({ sessionID: props.session.id });
        setSessionRemoved(true);
      }
      if (props.worktree) {
        await props.removeWorktree({
          projectID: props.worktree.projectID,
          directory: props.worktree.directory,
          force: true,
        });
      }
      deleted = true;
    } catch {
      setError(
        sessionRemoved() && props.worktree
          ? "The session was deleted, but its worktree could not be removed. Try again to finish cleanup."
          : "The session could not be deleted. Check the connection and try again.",
      );
    } finally {
      setDeleting(false);
      setDismissBlocked(false);
    }
    if (!deleted) return;

    props.onDeleted(props.subtreeIDs);
    dialog.close();
  };

  createEffect(() => setDismissBlocked(deleting()));

  onMount(() => {
    void dialog
      .show(
        () => (
          <DeleteSessionDialog
            title={title()}
            descendantCount={props.subtreeIDs.length - 1}
            worktreeDirectory={props.worktree?.directory}
            deleting={deleting()}
            sessionRemoved={sessionRemoved()}
            error={error()}
            onDelete={() => void deleteSession()}
          />
        ),
        () => {
          queueMicrotask(() => {
            if (!closingFlow) props.onDismiss();
          });
        },
      )
      .then(() => {
        activeDialog = dialog.active;
        if (closingFlow && dialog.active === activeDialog) dialog.close();
        return undefined;
      });
  });

  onCleanup(() => {
    closingFlow = true;
    setDismissBlocked(false);
    if (dialog.active === activeDialog) dialog.close();
  });

  return null;
}
