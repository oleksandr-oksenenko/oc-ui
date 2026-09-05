import { useAtomValue } from "@effect/atom-solid";
import type { PermissionReply, PermissionRequest } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { Cause, Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

type SessionPermissionsData = {
  readonly on: Data["on"];
  readonly session: Pick<Data["session"], "permission">;
};

type SessionPermissionsInput = {
  readonly effects: WorkspaceOwner;
  readonly data: SessionPermissionsData;
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
};

type SessionPermissionsState = "loading" | "ready" | "failed";

export type SessionPermissionsController = {
  readonly requests: Accessor<readonly PermissionRequest[]>;
  readonly state: Accessor<SessionPermissionsState>;
  readonly error: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (requestID: string) => boolean;
  readonly errorFor: (requestID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (requestID: string, reply: PermissionReply) => Promise<void>;
};

type PermissionIdentity = {
  readonly sessionID: string;
  readonly requestID: string;
  readonly key: string;
};

type SelectionOwner = { readonly token: symbol };

type MutationState = {
  readonly pending: boolean;
  readonly submitting?: string;
  readonly blocked?: PermissionIdentity;
  readonly errors: ReadonlyMap<string, string>;
};

const SYNC_FAILURE_MESSAGE = "Permissions could not be refreshed. Try again.";
const REPLY_FAILURE_MESSAGE = "The permission response could not be sent. Try again.";
const permissionKey = (sessionID: string, requestID: string): string =>
  `${sessionID}\u0000${requestID}`;

/** Owns selected-session permission loading and workspace-wide reply coordination. */
export function createSessionPermissions(
  input: SessionPermissionsInput,
): SessionPermissionsController {
  const { effects } = input;
  const status = Atom.make<{ state: SessionPermissionsState; error?: string }>({
    state: input.selectedID() !== undefined && input.connected() ? "loading" : "ready",
  });
  const fences = Atom.make<ReadonlyMap<string, true>>(new Map());
  const mutation = Atom.make<MutationState>({ pending: false, errors: new Map() });
  effects.mount(status);
  effects.mount(fences);
  effects.mount(mutation);

  const current = useAtomValue(() => status);
  const fenced = useAtomValue(() => fences);
  const mutationState = useAtomValue(() => mutation);
  const read = effects.latest<boolean>();
  let selection: SelectionOwner | undefined = { token: Symbol() };

  const requests = createMemo<readonly PermissionRequest[]>(() => {
    current();
    const sessionID = input.selectedID();
    if (sessionID === undefined) return [];
    const hidden = fenced();
    return (input.data.session.permission.list(sessionID) ?? []).filter(
      (request) => !hidden.has(permissionKey(sessionID, request.id)),
    );
  });

  const setFence = (key: string) => {
    effects.registry.set(fences, new Map(effects.registry.get(fences)).set(key, true));
  };
  const clearFence = (key: string) => {
    const next = new Map(effects.registry.get(fences));
    next.delete(key);
    effects.registry.set(fences, next);
  };
  const reconcileFences = (sessionID: string) => {
    const present = new Set(
      (input.data.session.permission.list(sessionID) ?? []).map((request) =>
        permissionKey(sessionID, request.id),
      ),
    );
    const prefix = `${sessionID}\u0000`;
    const next = new Map(
      [...effects.registry.get(fences)].filter(
        ([key]) => !key.startsWith(prefix) || present.has(key),
      ),
    );
    effects.registry.set(fences, next);

    const mutationSnapshot = effects.registry.get(mutation);
    const errors = new Map(
      [...mutationSnapshot.errors].filter(([key]) => !key.startsWith(prefix) || present.has(key)),
    );
    if (errors.size !== mutationSnapshot.errors.size) {
      effects.registry.set(mutation, { ...mutationSnapshot, errors });
    }
  };

  const finishBlockedSync = (sessionID: string) => {
    const state = effects.registry.get(mutation);
    const blocked = state.blocked;
    if (!blocked || blocked.sessionID !== sessionID) return;

    clearFence(blocked.key);
    const stillPending = (input.data.session.permission.list(sessionID) ?? []).some(
      (request) => request.id === blocked.requestID,
    );
    const errors = new Map(state.errors);
    if (!stillPending) errors.delete(blocked.key);
    effects.registry.set(mutation, { pending: false, errors });
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
      if (publishesStatus()) effects.registry.set(status, { state: "ready" });
      return false;
    }
    if (publishesStatus()) effects.registry.set(status, { state: "loading" });
    input.data.session.permission.invalidate(sessionID);
    return yield* effects
      .request(() => input.data.session.permission.sync(sessionID))
      .pipe(
        Effect.match({
          onSuccess: () => {
            reconcileFences(sessionID);
            finishBlockedSync(sessionID);
            if (publishesStatus()) effects.registry.set(status, { state: "ready" });
            return true;
          },
          onFailure: () => {
            if (publishesStatus()) {
              effects.registry.set(status, {
                state: "failed",
                error: SYNC_FAILURE_MESSAGE,
              });
            }
            return false;
          },
        }),
      );
  });

  const selectedRefresh = () => {
    const sessionID = input.selectedID();
    const initiatingSelection = selection;
    return sessionID === undefined || initiatingSelection === undefined
      ? Effect.succeed(true)
      : refreshSession(sessionID, initiatingSelection);
  };
  const startRefresh = () => read.run(selectedRefresh());
  const joinRefresh = () =>
    Fiber.join(startRefresh()).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.succeed(false)),
    );

  const sync = (): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        const blocked = effects.registry.get(mutation).blocked;
        if (blocked) {
          const token = input.selectedID() === blocked.sessionID ? selection : undefined;
          yield* refreshSession(blocked.sessionID, token);
          if (input.selectedID() === blocked.sessionID) return;
        }
        yield* joinRefresh();
      }),
    );

  const respond = Effect.fn("permissions.reply")(function* (
    requestID: string,
    reply: PermissionReply,
  ) {
    const sessionID = input.selectedID();
    const state = effects.registry.get(mutation);
    const request = requests().find((candidate) => candidate.id === requestID);
    if (
      sessionID === undefined ||
      selection === undefined ||
      !input.connected() ||
      current().state !== "ready" ||
      state.pending ||
      !request ||
      (reply === "always" &&
        (!request.save?.length || request.save.some((pattern) => pattern.length === 0)))
    )
      return;

    const identity: PermissionIdentity = {
      sessionID,
      requestID: request.id,
      key: permissionKey(sessionID, request.id),
    };
    const errors = new Map(state.errors);
    errors.delete(identity.key);
    effects.registry.set(mutation, {
      pending: true,
      submitting: identity.key,
      errors,
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
      const nextErrors = new Map(latest.errors);
      if (!replied) nextErrors.set(identity.key, REPLY_FAILURE_MESSAGE);
      effects.registry.set(mutation, {
        pending: true,
        blocked: identity,
        errors: nextErrors,
      });
      return;
    }

    // This post-settlement snapshot is authoritative for our own response. A
    // pre-settlement replied event must not hide a request whose reply failed.
    clearFence(identity.key);
    const stillPending = (input.data.session.permission.list(sessionID) ?? []).some(
      (candidate) => candidate.id === request.id,
    );
    const nextErrors = new Map(latest.errors);
    if (!replied && stillPending) nextErrors.set(identity.key, REPLY_FAILURE_MESSAGE);
    else nextErrors.delete(identity.key);
    effects.registry.set(mutation, { pending: false, errors: nextErrors });
  });

  const stopAsked = input.data.on("permission.asked", (event) => {
    const sessionID = event.data.sessionID;
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startRefresh();
  });
  const stopReplied = input.data.on("permission.replied", (event) => {
    const sessionID = event.data.sessionID;
    setFence(permissionKey(sessionID, event.data.requestID));
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startRefresh();
  });

  createEffect(
    on([input.selectedID, input.connected], () => {
      selection = { token: Symbol() };
      effects.registry.set(status, {
        state: input.selectedID() !== undefined && input.connected() ? "loading" : "ready",
      });
      startRefresh();
    }),
  );
  onCleanup(() => {
    selection = undefined;
    read.cancel();
    stopAsked();
    stopReplied();
  });

  const selectedMutation = (requestID: string) => {
    const sessionID = input.selectedID();
    return sessionID === undefined
      ? undefined
      : { state: mutationState(), key: permissionKey(sessionID, requestID) };
  };

  return {
    requests,
    state: () => (mutationState().blocked ? "failed" : current().state),
    error: () => (mutationState().blocked ? SYNC_FAILURE_MESSAGE : current().error),
    pending: () => mutationState().pending,
    submitting: (requestID) => {
      const selected = selectedMutation(requestID);
      return selected !== undefined && selected.state.submitting === selected.key;
    },
    errorFor: (requestID) => {
      const selected = selectedMutation(requestID);
      return selected && selected.state.errors.get(selected.key);
    },
    sync,
    reply: (requestID, reply) => effects.runPromise(respond(requestID, reply)),
  };
}
