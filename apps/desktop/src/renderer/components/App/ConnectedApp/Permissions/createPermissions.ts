import { useAtomValue } from "@effect/atom-solid";
import type { PermissionReply, PermissionRequest } from "@opencode/client";
import type { Data } from "@opencode/client/solid";
import { Cause, Effect, Fiber, Semaphore } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

type PermissionsState = "loading" | "ready" | "failed";

type PermissionsData = {
  readonly on: Data["on"];
  readonly session: {
    readonly permission: Pick<Data["session"]["permission"], "sync" | "invalidate" | "reply"> & {
      // The SDK returns undefined until this session cache is hydrated.
      readonly list: (
        sessionID: string,
      ) => ReturnType<Data["session"]["permission"]["list"]> | undefined;
    };
  };
};

export type PermissionsInput = {
  readonly effects: WorkspaceOwner;
  readonly data: PermissionsData;
  readonly selectedID: Accessor<string | undefined>;
  /** Descendant sessions of the selection, in display order; their requests bubble up. */
  readonly subagentIDs: Accessor<readonly string[]>;
  readonly connected: Accessor<boolean>;
};

export type SessionPermissionsController = {
  readonly requests: Accessor<readonly PermissionRequest[]>;
  readonly state: Accessor<PermissionsState>;
  readonly error: Accessor<string | undefined>;
  readonly recoveryError: Accessor<string | undefined>;
  /** Set when a descendant session's requests could not be loaded. */
  readonly subagentError: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (requestID: string) => boolean;
  readonly errorFor: (requestID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly retrySubagents: () => Promise<void>;
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
const SUBAGENT_LOAD_FAILURE = "Some subagent requests could not be loaded.";
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
  const subagentFailures = Atom.make(new Set<string>());
  effects.mount(selectedStatus);
  effects.mount(fences);
  effects.mount(mutation);
  effects.mount(subagentFailures);

  const selectedCurrent = useAtomValue(() => selectedStatus);
  const fenced = useAtomValue(() => fences);
  const mutationState = useAtomValue(() => mutation);
  const subagentFailureSet = useAtomValue(() => subagentFailures);
  const selectedRead = effects.latest<boolean>();
  const hydration = effects.latest();
  const descendantPermits = Semaphore.makeUnsafe(4);
  let selection: SelectionOwner | undefined = { token: Symbol() };
  const visibleRequests = (sessionID: string): readonly PermissionRequest[] => {
    const hidden = fenced();
    return (input.data.session.permission.list(sessionID) ?? []).filter(
      (request) => !hidden.has(replyKey(sessionID, request.id)),
    );
  };

  const requests = createMemo<readonly PermissionRequest[]>(() => {
    selectedCurrent();
    const selected = input.selectedID();
    if (selected === undefined) return [];
    const visible = visibleRequests(selected);
    return input
      .subagentIDs()
      .reduce<readonly PermissionRequest[]>(
        (all, sessionID) => [...all, ...visibleRequests(sessionID)],
        visible,
      );
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

  const syncSession = Effect.fn("permissions.syncSession")(function* (sessionID: string) {
    input.data.session.permission.invalidate(sessionID);
    const synced = yield* effects
      .request(() => input.data.session.permission.sync(sessionID))
      .pipe(
        Effect.match({
          onSuccess: () => {
            reconcileSessionMetadata(sessionID);
            finishBlockedSessionSync(sessionID);
            return true;
          },
          onFailure: () => false,
        }),
      );
    setSubagentFailure(sessionID, !synced);
    return synced;
  });

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
    const synced = yield* syncSession(sessionID);
    if (publishesStatus()) {
      effects.registry.set(
        selectedStatus,
        synced ? { state: "ready" } : { state: "failed", error: SELECTED_SYNC_FAILURE },
      );
    }
    return synced;
  });

  const setSubagentFailure = (sessionID: string, failed: boolean) => {
    if (failed && !input.subagentIDs().includes(sessionID)) return;
    const current = effects.registry.get(subagentFailures);
    if (current.has(sessionID) === failed) return;
    const next = new Set(current);
    if (failed) next.add(sessionID);
    else next.delete(sessionID);
    effects.registry.set(subagentFailures, next);
  };

  /** Re-checks ownership after a permit is granted so departed sessions stop queuing work. */
  const syncSubagentNow = (sessionID: string) =>
    Effect.suspend(() =>
      input.connected() && input.subagentIDs().includes(sessionID)
        ? syncSession(sessionID)
        : Effect.void,
    );

  /** Bounds descendant reads; every bubbled session shares the same permit pool. */
  const syncSubagentBatch = (sessionIDs: readonly string[]) =>
    Effect.forEach(
      sessionIDs,
      (sessionID) => descendantPermits.withPermits(1)(syncSubagentNow(sessionID)),
      { concurrency: "unbounded", discard: true },
    );

  /** Refreshes a bubbled subagent session without owning the selected-session status. */
  const syncSubagent = (sessionID: string) => {
    if (sessionID === input.selectedID() || !input.subagentIDs().includes(sessionID)) return;
    effects.runFork(Effect.ignore(descendantPermits.withPermits(1)(syncSubagentNow(sessionID))));
  };

  const pruneSubagentFailures = (sessionIDs: readonly string[]) => {
    const active = new Set(sessionIDs);
    const current = effects.registry.get(subagentFailures);
    if ([...current].every((sessionID) => active.has(sessionID))) return;
    effects.registry.set(
      subagentFailures,
      new Set([...current].filter((sessionID) => active.has(sessionID))),
    );
  };

  /** Hydrates descendant caches that the sidebar attention pass has not loaded yet. */
  const hydrateSubagents = (sessionIDs: readonly string[]) => {
    if (!input.connected()) return;
    const missing = sessionIDs.filter(
      (sessionID) => input.data.session.permission.list(sessionID) === undefined,
    );
    // Runs even when nothing is missing so a shrunken subtree cancels queued reads.
    hydration.run(syncSubagentBatch(missing));
  };

  const retrySubagents = (): Promise<void> => {
    if (!input.connected()) return Promise.resolve();
    const visible = input.subagentIDs();
    const failed = [...effects.registry.get(subagentFailures)].filter((sessionID) =>
      visible.includes(sessionID),
    );
    if (failed.length === 0) return Promise.resolve();
    // Unions with still-unloaded caches so recovery never discards queued hydration.
    const targets = [
      ...new Set([
        ...failed,
        ...visible.filter(
          (sessionID) => input.data.session.permission.list(sessionID) === undefined,
        ),
      ]),
    ];
    return effects.runPromise(
      Fiber.join(hydration.run(syncSubagentBatch(targets))).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
      ),
    );
  };

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
    !state.pending &&
    request !== undefined &&
    (request.sessionID === input.selectedID()
      ? selectedCurrent().state === "ready"
      : input.subagentIDs().includes(request.sessionID)) &&
    (reply !== "always" ||
      (!!request.save?.length && request.save.every((pattern) => pattern.length > 0)));

  const respond = Effect.fn("permissions.reply")(function* (
    requestID: string,
    reply: PermissionReply,
  ) {
    const state = effects.registry.get(mutation);
    const request = requests().find((candidate) => candidate.id === requestID);
    if (request === undefined || !canReply(request, reply, state)) return;
    const sessionID = request.sessionID;

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
    else syncSubagent(sessionID);
  });
  const stopReplied = input.data.on("permission.replied", (event) => {
    const sessionID = event.data.sessionID;
    const current = effects.registry.get(mutation);
    if (
      sessionID === input.selectedID() ||
      input.subagentIDs().includes(sessionID) ||
      current.submitting?.sessionID === sessionID ||
      current.blocked?.sessionID === sessionID
    ) {
      setFence(replyKey(sessionID, event.data.requestID));
    }
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startSelectedRefresh();
    else syncSubagent(sessionID);
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
  const subagentSessions = createMemo(() => input.subagentIDs(), undefined, {
    equals: (previous, next) =>
      previous.length === next.length &&
      previous.every((sessionID, index) => sessionID === next[index]),
  });
  createEffect(
    on([subagentSessions, input.connected, input.selectedID], ([sessionIDs, connected]) => {
      if (!connected) {
        hydration.run(Effect.void);
        return;
      }
      pruneSubagentFailures(sessionIDs);
      hydrateSubagents(sessionIDs);
    }),
  );
  onCleanup(() => {
    selection = undefined;
    selectedRead.cancel();
    hydration.cancel();
    stopAsked();
    stopReplied();
  });

  const replyState = (requestID: string) => {
    const request = requests().find((candidate) => candidate.id === requestID);
    return request === undefined
      ? undefined
      : { state: mutationState(), key: replyKey(request.sessionID, requestID) };
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
    subagentError: () => {
      if (!input.connected()) return undefined;
      const visible = new Set(input.subagentIDs());
      return [...subagentFailureSet()].some((sessionID) => visible.has(sessionID))
        ? SUBAGENT_LOAD_FAILURE
        : undefined;
    },
    pending: () => mutationState().pending,
    submitting: (requestID) => {
      const current = replyState(requestID);
      return current !== undefined && current.state.submitting?.key === current.key;
    },
    errorFor: (requestID) => {
      const current = replyState(requestID);
      return current?.state.replyErrors.get(current.key);
    },
    sync: syncSelected,
    retrySubagents,
    reply: (requestID, reply) => effects.runPromise(respond(requestID, reply)),
  };
}
