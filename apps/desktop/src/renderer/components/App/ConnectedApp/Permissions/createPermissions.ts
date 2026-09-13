import { useAtomValue } from "@effect/atom-solid";
import type { PermissionReply, PermissionRequest } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { Cause, Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

type PermissionsState = "loading" | "ready" | "failed";

type PermissionsData = {
  readonly on: Data["on"];
  readonly session: Pick<Data["session"], "permission">;
};

export type PermissionsInput = {
  readonly effects: WorkspaceOwner;
  readonly data: PermissionsData;
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
};

export type SessionPermissionsController = {
  readonly requests: Accessor<readonly PermissionRequest[]>;
  readonly state: Accessor<PermissionsState>;
  readonly error: Accessor<string | undefined>;
  readonly recoveryError: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (requestID: string) => boolean;
  readonly errorFor: (requestID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (requestID: string, reply: PermissionReply) => Promise<void>;
};

type ReplyIdentity = {
  readonly sessionID: string;
  readonly requestID: string;
  readonly key: string;
};

type MutationState = {
  readonly pending: boolean;
  readonly submitting?: ReplyIdentity;
  readonly blocked?: ReplyIdentity;
  readonly replyErrors: ReadonlyMap<string, string>;
};

type ReadStatus = { readonly state: PermissionsState; readonly error?: string };
type SelectionOwner = { readonly token: symbol };

const SELECTED_SYNC_FAILURE = "Permissions could not be refreshed. Try again.";
const REPLY_FAILURE = "The permission response could not be sent. Try again.";
const REPLY_RECOVERY_FAILURE =
  "A permission response could not be confirmed. Refresh permissions to continue.";
const replyKey = (sessionID: string, requestID: string): string => `${sessionID}\u0000${requestID}`;

/** Owns session replies and reconciliation for one connected workspace. */
export function createPermissions(input: PermissionsInput): SessionPermissionsController {
  const { effects } = input;
  const selectedStatus = Atom.make<ReadStatus>({
    state: input.selectedID() !== undefined && input.connected() ? "loading" : "ready",
  });
  const fences = Atom.make<ReadonlyMap<string, true>>(new Map());
  const mutation = Atom.make<MutationState>({
    pending: false,
    replyErrors: new Map(),
  });
  effects.mount(selectedStatus);
  effects.mount(fences);
  effects.mount(mutation);

  const selectedCurrent = useAtomValue(() => selectedStatus);
  const fenced = useAtomValue(() => fences);
  const mutationState = useAtomValue(() => mutation);
  const selectedRead = effects.latest<boolean>();
  let selection: SelectionOwner | undefined = { token: Symbol() };
  const visibleRequests = (sessionID: string): readonly PermissionRequest[] => {
    const hidden = fenced();
    return (input.data.session.permission.list(sessionID) ?? []).filter(
      (request) => !hidden.has(replyKey(sessionID, request.id)),
    );
  };

  const requests = createMemo<readonly PermissionRequest[]>(() => {
    selectedCurrent();
    const sessionID = input.selectedID();
    return sessionID === undefined ? [] : visibleRequests(sessionID);
  });

  const updateMutation = (next: MutationState) => effects.registry.set(mutation, next);
  const setFence = (key: string) => {
    effects.registry.set(fences, new Map(effects.registry.get(fences)).set(key, true));
  };
  const clearFence = (key: string) => {
    const next = new Map(effects.registry.get(fences));
    next.delete(key);
    effects.registry.set(fences, next);
  };

  const reconcileSessionMetadata = (sessionID: string) => {
    const present = new Set(
      (input.data.session.permission.list(sessionID) ?? []).map((request) =>
        replyKey(sessionID, request.id),
      ),
    );
    const prefix = `${sessionID}\u0000`;
    effects.registry.set(
      fences,
      new Map(
        [...effects.registry.get(fences)].filter(
          ([key]) => !key.startsWith(prefix) || present.has(key),
        ),
      ),
    );

    const state = effects.registry.get(mutation);
    const replyErrors = new Map(
      [...state.replyErrors].filter(([key]) => !key.startsWith(prefix) || present.has(key)),
    );
    if (replyErrors.size !== state.replyErrors.size) updateMutation({ ...state, replyErrors });
  };

  const finishBlockedSessionSync = (sessionID: string) => {
    const state = effects.registry.get(mutation);
    const blocked = state.blocked;
    if (!blocked || blocked.sessionID !== sessionID) return;
    clearFence(blocked.key);
    const stillPending = (input.data.session.permission.list(sessionID) ?? []).some(
      (request) => request.id === blocked.requestID,
    );
    const replyErrors = new Map(state.replyErrors);
    if (!stillPending) replyErrors.delete(blocked.key);
    updateMutation({ pending: false, replyErrors });
  };

  const refreshSession = Effect.fn("permissions.refreshSession")(function* (
    sessionID: string,
    initiatingSelection?: SelectionOwner,
  ) {
    const publishesStatus = () =>
      initiatingSelection !== undefined &&
      selection === initiatingSelection &&
      input.selectedID() === sessionID;
    if (!input.connected()) {
      if (publishesStatus()) effects.registry.set(selectedStatus, { state: "ready" });
      return false;
    }
    if (publishesStatus()) effects.registry.set(selectedStatus, { state: "loading" });
    input.data.session.permission.invalidate(sessionID);
    return yield* effects
      .request(() => input.data.session.permission.sync(sessionID))
      .pipe(
        Effect.match({
          onSuccess: () => {
            reconcileSessionMetadata(sessionID);
            finishBlockedSessionSync(sessionID);
            if (publishesStatus()) effects.registry.set(selectedStatus, { state: "ready" });
            return true;
          },
          onFailure: () => {
            if (publishesStatus()) {
              effects.registry.set(selectedStatus, {
                state: "failed",
                error: SELECTED_SYNC_FAILURE,
              });
            }
            return false;
          },
        }),
      );
  });

  const recoverBlocked = Effect.fn("permissions.recoverBlocked")(function* () {
    const blocked = effects.registry.get(mutation).blocked;
    if (!blocked) return true;
    return yield* refreshSession(
      blocked.sessionID,
      input.selectedID() === blocked.sessionID ? selection : undefined,
    );
  });

  const selectedRefresh = () => {
    const sessionID = input.selectedID();
    const initiatingSelection = selection;
    return sessionID === undefined || initiatingSelection === undefined
      ? Effect.succeed(true)
      : refreshSession(sessionID, initiatingSelection);
  };
  const startSelectedRefresh = () => selectedRead.run(selectedRefresh());
  const joinSelectedRefresh = () =>
    Fiber.join(startSelectedRefresh()).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.succeed(false)),
    );

  const syncSelected = (): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        if (!(yield* recoverBlocked())) return;
        yield* joinSelectedRefresh();
      }),
    );

  const canReply = (
    request: PermissionRequest | undefined,
    reply: PermissionReply,
    state: MutationState,
  ): request is PermissionRequest =>
    input.selectedID() !== undefined &&
    selection !== undefined &&
    input.connected() &&
    selectedCurrent().state === "ready" &&
    !state.pending &&
    request !== undefined &&
    (reply !== "always" ||
      (!!request.save?.length && request.save.every((pattern) => pattern.length > 0)));

  const respond = Effect.fn("permissions.reply")(function* (
    requestID: string,
    reply: PermissionReply,
  ) {
    const sessionID = input.selectedID();
    const state = effects.registry.get(mutation);
    const request = requests().find((candidate) => candidate.id === requestID);
    if (sessionID === undefined || !canReply(request, reply, state)) return;

    const identity: ReplyIdentity = {
      sessionID,
      requestID: request.id,
      key: replyKey(sessionID, request.id),
    };
    const replyErrors = new Map(state.replyErrors);
    replyErrors.delete(identity.key);
    updateMutation({
      pending: true,
      submitting: identity,
      replyErrors,
    });

    const replied = yield* effects
      .request(() =>
        input.data.session.permission.reply({ sessionID, requestID: request.id, reply }),
      )
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    const reconciled = yield* refreshSession(
      sessionID,
      input.selectedID() === sessionID ? selection : undefined,
    );
    const latest = effects.registry.get(mutation);
    if (!reconciled) {
      const replyErrorsAfterFailure = new Map(latest.replyErrors);
      if (!replied) replyErrorsAfterFailure.set(identity.key, REPLY_FAILURE);
      updateMutation({
        pending: true,
        blocked: identity,
        replyErrors: replyErrorsAfterFailure,
      });
      return;
    }

    clearFence(identity.key);
    const stillPending = (input.data.session.permission.list(sessionID) ?? []).some(
      (candidate) => candidate.id === request.id,
    );
    const nextErrors = new Map(latest.replyErrors);
    if (!replied && stillPending) nextErrors.set(identity.key, REPLY_FAILURE);
    else nextErrors.delete(identity.key);
    updateMutation({ pending: false, replyErrors: nextErrors });
  });

  const stopAsked = input.data.on("permission.asked", (event) => {
    const sessionID = event.data.sessionID;
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startSelectedRefresh();
  });
  const stopReplied = input.data.on("permission.replied", (event) => {
    const sessionID = event.data.sessionID;
    const current = effects.registry.get(mutation);
    if (
      sessionID === input.selectedID() ||
      current.submitting?.sessionID === sessionID ||
      current.blocked?.sessionID === sessionID
    ) {
      setFence(replyKey(sessionID, event.data.requestID));
    }
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startSelectedRefresh();
  });

  createEffect(
    on([input.selectedID, input.connected], () => {
      selection = { token: Symbol() };
      effects.registry.set(selectedStatus, {
        state: input.selectedID() !== undefined && input.connected() ? "loading" : "ready",
      });
      startSelectedRefresh();
    }),
  );
  onCleanup(() => {
    selection = undefined;
    selectedRead.cancel();
    stopAsked();
    stopReplied();
  });

  const selectedReplyState = (requestID: string) => {
    const sessionID = input.selectedID();
    return sessionID === undefined
      ? undefined
      : { state: mutationState(), key: replyKey(sessionID, requestID) };
  };
  return {
    requests,
    state: () => selectedCurrent().state,
    error: () => selectedCurrent().error,
    recoveryError: () => {
      const blocked = mutationState().blocked;
      if (!blocked) return undefined;
      return REPLY_RECOVERY_FAILURE;
    },
    pending: () => mutationState().pending,
    submitting: (requestID) => {
      const selected = selectedReplyState(requestID);
      return selected !== undefined && selected.state.submitting?.key === selected.key;
    },
    errorFor: (requestID) => {
      const selected = selectedReplyState(requestID);
      return selected && selected.state.replyErrors.get(selected.key);
    },
    sync: syncSelected,
    reply: (requestID, reply) => effects.runPromise(respond(requestID, reply)),
  };
}
