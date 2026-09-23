import { useAtomValue } from "@effect/atom-solid";
import { Effect, Result } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../../workspace-owner.ts";
import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { useDialog } from "@opencode/ui/context/dialog";
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";

import { useServerFlowDismissBlock } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import { sessionSubtreeIDs } from "../session-selection.ts";
import type { SessionDeletionStatus } from "../createSessionFlows.ts";
import { DeleteSessionDialog } from "./DeleteSessionFlow/DeleteSessionDialog.tsx";

export type CreateDeleteSessionFlowInput = {
  readonly effects: WorkspaceOwner;
  readonly session: SessionInfo;
  readonly subtreeIDs: readonly string[];
  readonly sessions: Accessor<readonly SessionInfo[]>;
  readonly sessionIDs: () => readonly string[];
  readonly syncCatalog: () => Promise<void>;
  readonly removeSession: OpenCodeClient["session"]["remove"];
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
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
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
    if (props.deletionStatusForSession(props.session.id) === "running") {
      update({
        error: "Wait for this session and its child sessions to finish before deleting.",
      });
      return;
    }

    const present = currentSessions.some((session) => session.id === props.session.id);
    const subtreeIDs = present
      ? sessionSubtreeIDs(props.session.id, currentSessions)
      : props.subtreeIDs;
    if (present) {
      const removed = yield* effects
        .request((signal) => props.removeSession({ sessionID: props.session.id }, { signal }))
        .pipe(Effect.result);
      if (Result.isFailure(removed)) {
        update({
          error: "The session could not be deleted. Check the connection and try again.",
        });
        return;
      }
    }

    // Registered worktrees are never removed with their sessions; they stay on
    // disk for explicit cleanup, matching OpenCode Desktop v2.
    props.onDeleted(subtreeIDs);
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
