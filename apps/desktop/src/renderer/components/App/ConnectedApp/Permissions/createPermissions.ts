import { useAtomValue } from "@effect/atom-solid";
import type {
  LocationRef,
  OpenCodeClient,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  Project,
  SessionInfo,
} from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { locationKey } from "@opencode-ai/client/solid";
import { Cause, Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

type PermissionsState = "loading" | "ready" | "failed";
type CatalogState = "loading" | "ready" | "failed";

type PermissionsData = {
  readonly on: Data["on"];
  readonly session: Pick<Data["session"], "permission">;
  readonly project: Pick<Data["project"], "list" | "sync" | "invalidate"> & {
    readonly permission: Pick<Data["project"]["permission"], "list" | "sync" | "invalidate">;
  };
};

type PermissionsApi = {
  readonly debug: {
    readonly location: Pick<OpenCodeClient["debug"]["location"], "list">;
  };
  readonly permission: {
    readonly request: Pick<OpenCodeClient["permission"]["request"], "list">;
    readonly saved: Pick<OpenCodeClient["permission"]["saved"], "remove">;
  };
};

export type PermissionsInput = {
  readonly effects: WorkspaceOwner;
  readonly api: PermissionsApi;
  readonly data: PermissionsData;
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
  readonly defaultLocation: LocationRef;
  readonly sessions: Accessor<readonly SessionInfo[]>;
  readonly catalogState: Accessor<CatalogState>;
};

export type PermissionInboxEntry = {
  readonly session: SessionInfo;
  readonly requests: readonly PermissionRequest[];
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

export type PermissionsController = SessionPermissionsController & {
  readonly inbox: {
    readonly entries: Accessor<readonly PermissionInboxEntry[]>;
    readonly state: Accessor<PermissionsState>;
    readonly error: Accessor<string | undefined>;
    readonly sync: () => Promise<void>;
  };
  readonly saved: {
    readonly rules: Accessor<readonly PermissionSavedInfo[]>;
    readonly projects: Accessor<readonly Project[]>;
    readonly state: Accessor<PermissionsState>;
    readonly error: Accessor<string | undefined>;
    readonly removing: (ruleID: string) => boolean;
    readonly errorFor: (ruleID: string) => string | undefined;
    readonly sync: () => Promise<void>;
    readonly remove: (ruleID: string) => Promise<void>;
  };
};

type ReplyIdentity = {
  readonly kind: "reply";
  readonly sessionID: string;
  readonly requestID: string;
  readonly reply: PermissionReply;
  readonly key: string;
};

type SavedIdentity = {
  readonly kind: "saved";
  readonly projectID: string;
  readonly ruleID: string;
  readonly key: string;
};

type MutationIdentity = ReplyIdentity | SavedIdentity;

type MutationState = {
  readonly pending: boolean;
  readonly submitting?: MutationIdentity;
  readonly blocked?: MutationIdentity;
  readonly replyErrors: ReadonlyMap<string, string>;
  readonly savedErrors: ReadonlyMap<string, string>;
};

type ReadStatus = { readonly state: PermissionsState; readonly error?: string };
type SelectionOwner = { readonly token: symbol };

const READ_CONCURRENCY = 4;
const SELECTED_SYNC_FAILURE = "Permissions could not be refreshed. Try again.";
const REPLY_FAILURE = "The permission response could not be sent. Try again.";
const INBOX_SYNC_FAILURE = "Some pending permissions could not be refreshed. Try again.";
const CATALOG_FAILURE = "Pending permissions are unavailable until sessions can be refreshed.";
const SAVED_SYNC_FAILURE = "Some saved approvals could not be refreshed. Try again.";
const SAVED_STALE_FAILURE = "Saved approvals may be out of date. Refresh them before revoking.";
const REMOVE_FAILURE = "The saved approval could not be revoked. Try again.";
const REPLY_RECOVERY_FAILURE =
  "A permission response could not be confirmed. Refresh permissions to continue.";
const SAVED_RECOVERY_FAILURE =
  "A saved approval change could not be confirmed. Refresh permissions to continue.";

const replyKey = (sessionID: string, requestID: string): string => `${sessionID}\u0000${requestID}`;
const savedKey = (projectID: string, ruleID: string): string => `${projectID}\u0000${ruleID}`;
const readStatus = (state: PermissionsState, error?: string): ReadStatus =>
  error === undefined ? { state } : { state, error };

/** Owns selected, inbox, and saved permission state for one connected workspace. */
export function createPermissions(input: PermissionsInput): PermissionsController {
  const { effects } = input;
  const selectedStatus = Atom.make<ReadStatus>({
    state: input.selectedID() !== undefined && input.connected() ? "loading" : "ready",
  });
  const inboxStatus = Atom.make<ReadStatus>({ state: "loading" });
  const savedStatus = Atom.make<ReadStatus>({ state: "failed", error: SAVED_STALE_FAILURE });
  const fences = Atom.make<ReadonlyMap<string, true>>(new Map());
  const mutation = Atom.make<MutationState>({
    pending: false,
    replyErrors: new Map(),
    savedErrors: new Map(),
  });
  effects.mount(selectedStatus);
  effects.mount(inboxStatus);
  effects.mount(savedStatus);
  effects.mount(fences);
  effects.mount(mutation);

  const selectedCurrent = useAtomValue(() => selectedStatus);
  const inboxCurrent = useAtomValue(() => inboxStatus);
  const savedCurrent = useAtomValue(() => savedStatus);
  const fenced = useAtomValue(() => fences);
  const mutationState = useAtomValue(() => mutation);
  const selectedRead = effects.latest<boolean>();
  const inboxRead = effects.latest<boolean>();
  const savedRead = effects.latest<boolean>();
  let selection: SelectionOwner | undefined = { token: Symbol() };
  let previouslyDiscovered = new Set<string>();
  let visibleLocationKeys: ReadonlySet<string> | undefined;
  const eventSessions = new Set<string>();
  let savedGeneration = 0;

  const markSavedStale = (): void => {
    savedGeneration += 1;
    effects.registry.set(savedStatus, { state: "failed", error: SAVED_STALE_FAILURE });
  };
  const beginSavedProjectRefresh = (): number => {
    const generation = ++savedGeneration;
    if (effects.registry.get(savedStatus).state === "ready") {
      effects.registry.set(savedStatus, { state: "loading" });
    }
    return generation;
  };

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

  const inboxEntries = createMemo<readonly PermissionInboxEntry[]>(() => {
    inboxCurrent();
    return input.sessions().flatMap((session) => {
      if (visibleLocationKeys && !visibleLocationKeys.has(locationKey(session.location))) return [];
      const pending = visibleRequests(session.id);
      return pending.length === 0 ? [] : [{ session, requests: pending }];
    });
  });

  const projects = createMemo<readonly Project[]>(() => {
    savedCurrent();
    return input.data.project.list();
  });

  const rules = createMemo<readonly PermissionSavedInfo[]>(() =>
    projects().flatMap((project) => input.data.project.permission.list(project.id) ?? []),
  );

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

  const reconcileProjectMetadata = (projectID: string) => {
    const present = new Set(
      (input.data.project.permission.list(projectID) ?? []).map((rule) =>
        savedKey(projectID, rule.id),
      ),
    );
    const prefix = `${projectID}\u0000`;
    const state = effects.registry.get(mutation);
    const savedErrors = new Map(
      [...state.savedErrors].filter(([key]) => !key.startsWith(prefix) || present.has(key)),
    );
    if (savedErrors.size !== state.savedErrors.size) updateMutation({ ...state, savedErrors });
  };

  const finishBlockedSessionSync = (sessionID: string) => {
    const state = effects.registry.get(mutation);
    const blocked = state.blocked;
    if (!blocked || blocked.kind !== "reply" || blocked.sessionID !== sessionID) return;
    clearFence(blocked.key);
    const stillPending = (input.data.session.permission.list(sessionID) ?? []).some(
      (request) => request.id === blocked.requestID,
    );
    const replyErrors = new Map(state.replyErrors);
    if (!stillPending) replyErrors.delete(blocked.key);
    updateMutation({ pending: false, replyErrors, savedErrors: state.savedErrors });
  };

  const finishBlockedProjectSync = (projectID: string) => {
    const state = effects.registry.get(mutation);
    const blocked = state.blocked;
    if (!blocked || blocked.kind !== "saved" || blocked.projectID !== projectID) return;
    const stillPresent = (input.data.project.permission.list(projectID) ?? []).some(
      (rule) => rule.id === blocked.ruleID,
    );
    const savedErrors = new Map(state.savedErrors);
    if (stillPresent) savedErrors.set(blocked.key, REMOVE_FAILURE);
    else savedErrors.delete(blocked.key);
    updateMutation({ pending: false, replyErrors: state.replyErrors, savedErrors });
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

  const refreshProjectRules = Effect.fn("permissions.refreshProjectRules")(function* (
    projectID: string,
  ) {
    if (!input.connected()) return false;
    input.data.project.permission.invalidate(projectID);
    return yield* effects
      .request(() => input.data.project.permission.sync(projectID))
      .pipe(
        Effect.match({
          onSuccess: () => {
            reconcileProjectMetadata(projectID);
            finishBlockedProjectSync(projectID);
            return true;
          },
          onFailure: () => false,
        }),
      );
  });

  const recoverBlocked = Effect.fn("permissions.recoverBlocked")(function* () {
    const blocked = effects.registry.get(mutation).blocked;
    if (!blocked) return true;
    return blocked.kind === "reply"
      ? yield* refreshSession(
          blocked.sessionID,
          input.selectedID() === blocked.sessionID ? selection : undefined,
        )
      : yield* refreshProjectRules(blocked.projectID);
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

  const locations = (loaded: readonly LocationRef[]): readonly LocationRef[] => {
    const result = new Map<string, LocationRef>();
    result.set(locationKey(input.defaultLocation), input.defaultLocation);
    for (const location of loaded) result.set(locationKey(location), location);
    return [...result.values()];
  };

  const hydrateEventSessions = () => {
    const catalogIDs = new Set(input.sessions().map((session) => session.id));
    return Effect.all(
      [...eventSessions]
        .filter((sessionID) => catalogIDs.has(sessionID))
        .map((sessionID) => refreshSession(sessionID)),
      { concurrency: READ_CONCURRENCY },
    );
  };

  const refreshInbox = Effect.fn("permissions.refreshInbox")(function* () {
    if (input.catalogState() !== "ready") {
      const failed = input.catalogState() === "failed";
      effects.registry.set(
        inboxStatus,
        readStatus(failed ? "failed" : "loading", failed ? CATALOG_FAILURE : undefined),
      );
      return false;
    }
    if (!input.connected()) return false;
    effects.registry.set(inboxStatus, { state: "loading" });

    const loaded = yield* effects
      .request((signal) => input.api.debug.location.list({ signal }))
      .pipe(
        Effect.match({
          onSuccess: (loadedLocations) => loadedLocations,
          onFailure: () => undefined,
        }),
      );
    if (loaded === undefined) {
      yield* hydrateEventSessions();
      effects.registry.set(inboxStatus, { state: "failed", error: INBOX_SYNC_FAILURE });
      return false;
    }
    eventSessions.clear();
    const discoverableLocations = locations(loaded);
    const discoverableKeys = new Set(discoverableLocations.map(locationKey));

    const discovery = yield* Effect.all(
      discoverableLocations.map((location) =>
        effects
          .request((signal) =>
            input.api.permission.request.list(
              {
                location: {
                  directory: location.directory,
                  workspace: location.workspaceID,
                },
              },
              { signal },
            ),
          )
          .pipe(
            Effect.match({
              onSuccess: (response) => ({
                succeeded: true as const,
                sessionIDs: response.data.map((request) => request.sessionID),
              }),
              onFailure: () => ({ succeeded: false as const, sessionIDs: [] }),
            }),
          ),
      ),
      { concurrency: READ_CONCURRENCY },
    );
    const catalogSessions = input.sessions();
    const catalogIDs = new Set(catalogSessions.map((session) => session.id));
    const discovered = new Set(
      discovery.flatMap((result) => result.sessionIDs).filter((id) => catalogIDs.has(id)),
    );
    const discoverableCatalogIDs = new Set(
      catalogSessions
        .filter((session) => discoverableKeys.has(locationKey(session.location)))
        .map((session) => session.id),
    );
    previouslyDiscovered = new Set(
      [...previouslyDiscovered].filter((id) => discoverableCatalogIDs.has(id)),
    );
    const cached = catalogSessions
      .filter(
        (session) =>
          discoverableCatalogIDs.has(session.id) &&
          (input.data.session.permission.list(session.id) ?? []).length > 0,
      )
      .map((session) => session.id);
    const hydrationIDs = new Set([...discovered, ...previouslyDiscovered, ...cached]);
    const hydration = yield* Effect.all(
      [...hydrationIDs].map((sessionID) => refreshSession(sessionID)),
      { concurrency: READ_CONCURRENCY },
    );
    const succeeded = discovery.every((result) => result.succeeded) && hydration.every(Boolean);
    previouslyDiscovered = succeeded
      ? discovered
      : new Set([...previouslyDiscovered, ...discovered]);
    visibleLocationKeys = discoverableKeys;
    effects.registry.set(
      inboxStatus,
      readStatus(succeeded ? "ready" : "failed", succeeded ? undefined : INBOX_SYNC_FAILURE),
    );
    return succeeded;
  });

  const startInboxRefresh = () => inboxRead.run(refreshInbox());
  const joinInboxRefresh = () =>
    Fiber.join(startInboxRefresh()).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.succeed(false)),
    );

  const refreshSaved = Effect.fn("permissions.refreshSaved")(function* () {
    if (!input.connected()) return false;
    const generation = ++savedGeneration;
    effects.registry.set(savedStatus, { state: "loading" });
    input.data.project.invalidate();
    const projectListSucceeded = yield* effects
      .request(() => input.data.project.sync())
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    if (!projectListSucceeded) {
      if (generation === savedGeneration) {
        effects.registry.set(savedStatus, { state: "failed", error: SAVED_SYNC_FAILURE });
      }
      return false;
    }
    const refreshed = yield* Effect.all(
      input.data.project.list().map((project) => refreshProjectRules(project.id)),
      { concurrency: READ_CONCURRENCY },
    );
    const succeeded = refreshed.every(Boolean);
    if (generation === savedGeneration) {
      effects.registry.set(
        savedStatus,
        readStatus(succeeded ? "ready" : "failed", succeeded ? undefined : SAVED_SYNC_FAILURE),
      );
    }
    return succeeded;
  });

  const startSavedRefresh = () => savedRead.run(refreshSaved());
  const joinSavedRefresh = () =>
    Fiber.join(startSavedRefresh()).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.succeed(false)),
    );

  const publicSync = (refresh: () => Effect.Effect<boolean>): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        if (!(yield* recoverBlocked())) return;
        yield* refresh();
      }),
    );
  const syncSelected = () => publicSync(joinSelectedRefresh);
  const syncInbox = () => publicSync(joinInboxRefresh);
  const syncSaved = () => publicSync(joinSavedRefresh);

  const refreshSavedAfterAlways = Effect.fn("permissions.refreshSavedAfterAlways")(function* (
    projectID: string,
    restoreReady: boolean,
    generation: number,
  ) {
    const succeeded = yield* refreshProjectRules(projectID);
    if (generation !== savedGeneration) return;
    if (!succeeded) {
      effects.registry.set(savedStatus, { state: "failed", error: SAVED_STALE_FAILURE });
    } else if (restoreReady) {
      effects.registry.set(savedStatus, { state: "ready" });
    }
  });

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
      kind: "reply",
      sessionID,
      requestID: request.id,
      reply,
      key: replyKey(sessionID, request.id),
    };
    const projectID = input.sessions().find((session) => session.id === sessionID)?.projectID;
    const replyErrors = new Map(state.replyErrors);
    replyErrors.delete(identity.key);
    updateMutation({
      pending: true,
      submitting: identity,
      replyErrors,
      savedErrors: state.savedErrors,
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
        savedErrors: latest.savedErrors,
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
    const settled = effects.registry.get(mutation);
    updateMutation({ pending: false, replyErrors: nextErrors, savedErrors: settled.savedErrors });
    if (reply === "always" && projectID !== undefined && (replied || !stillPending)) {
      const savedState = effects.registry.get(savedStatus).state;
      if (savedState === "loading") {
        yield* joinSavedRefresh();
      } else {
        const generation = beginSavedProjectRefresh();
        yield* refreshSavedAfterAlways(projectID, savedState === "ready", generation);
      }
    }
  });

  const revoke = Effect.fn("permissions.revoke")(function* (ruleID: string) {
    const state = effects.registry.get(mutation);
    const rule = rules().find((candidate) => candidate.id === ruleID);
    if (
      selection === undefined ||
      !input.connected() ||
      savedCurrent().state !== "ready" ||
      state.pending ||
      !rule ||
      !projects().some((project) => project.id === rule.projectID)
    )
      return;
    const identity: SavedIdentity = {
      kind: "saved",
      projectID: rule.projectID,
      ruleID: rule.id,
      key: savedKey(rule.projectID, rule.id),
    };
    const savedErrors = new Map(state.savedErrors);
    savedErrors.delete(identity.key);
    updateMutation({
      pending: true,
      submitting: identity,
      replyErrors: state.replyErrors,
      savedErrors,
    });

    yield* effects
      .request((signal) => input.api.permission.saved.remove({ id: rule.id }, { signal }))
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    const reconciled = yield* refreshProjectRules(rule.projectID);
    const latest = effects.registry.get(mutation);
    if (!reconciled) {
      updateMutation({
        pending: true,
        blocked: identity,
        replyErrors: latest.replyErrors,
        savedErrors: latest.savedErrors,
      });
      return;
    }
    const stillPresent = (input.data.project.permission.list(rule.projectID) ?? []).some(
      (candidate) => candidate.id === rule.id,
    );
    const nextErrors = new Map(latest.savedErrors);
    if (stillPresent) nextErrors.set(identity.key, REMOVE_FAILURE);
    else nextErrors.delete(identity.key);
    updateMutation({ pending: false, replyErrors: latest.replyErrors, savedErrors: nextErrors });
  });

  const invalidateSavedCaches = (sessionID: string, stale: boolean) => {
    const projectID = input.sessions().find((session) => session.id === sessionID)?.projectID;
    const currentProjects = input.data.project.list();
    const affected =
      projectID === undefined
        ? currentProjects
        : currentProjects.filter(({ id }) => id === projectID);
    for (const project of affected) input.data.project.permission.invalidate(project.id);
    if (stale) markSavedStale();
  };
  const stopAsked = input.data.on("permission.asked", (event) => {
    const sessionID = event.data.sessionID;
    const session = input.sessions().find((candidate) => candidate.id === sessionID);
    if (session) {
      eventSessions.add(sessionID);
      if (visibleLocationKeys) {
        visibleLocationKeys = new Set([...visibleLocationKeys, locationKey(session.location)]);
      }
    }
    input.data.session.permission.invalidate(sessionID);
    if (sessionID === input.selectedID()) startSelectedRefresh();
    startInboxRefresh();
  });
  const stopReplied = input.data.on("permission.replied", (event) => {
    const sessionID = event.data.sessionID;
    eventSessions.delete(sessionID);
    setFence(replyKey(sessionID, event.data.requestID));
    input.data.session.permission.invalidate(sessionID);
    if (event.data.reply === "always") {
      const submitting = effects.registry.get(mutation).submitting;
      const ownReply =
        submitting?.kind === "reply" &&
        submitting.sessionID === sessionID &&
        submitting.requestID === event.data.requestID &&
        submitting.reply === event.data.reply;
      invalidateSavedCaches(sessionID, !ownReply);
    }
    if (sessionID === input.selectedID()) startSelectedRefresh();
    startInboxRefresh();
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
  let previousConnection = input.connected();
  createEffect(
    on(input.connected, (connected) => {
      if (connected !== previousConnection) markSavedStale();
      previousConnection = connected;
    }),
  );
  const catalogSignature = createMemo(() =>
    JSON.stringify([
      input.catalogState(),
      input.connected(),
      locationKey(input.defaultLocation),
      input.sessions().map((session) => [session.id, locationKey(session.location)]),
    ]),
  );
  createEffect(on(catalogSignature, () => startInboxRefresh()));

  onCleanup(() => {
    selection = undefined;
    selectedRead.cancel();
    inboxRead.cancel();
    savedRead.cancel();
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
      return blocked.kind === "reply" ? REPLY_RECOVERY_FAILURE : SAVED_RECOVERY_FAILURE;
    },
    pending: () => mutationState().pending,
    submitting: (requestID) => {
      const selected = selectedReplyState(requestID);
      return (
        selected !== undefined &&
        selected.state.submitting?.kind === "reply" &&
        selected.state.submitting.key === selected.key
      );
    },
    errorFor: (requestID) => {
      const selected = selectedReplyState(requestID);
      return selected && selected.state.replyErrors.get(selected.key);
    },
    sync: syncSelected,
    reply: (requestID, reply) => effects.runPromise(respond(requestID, reply)),
    inbox: {
      entries: inboxEntries,
      state: () => inboxCurrent().state,
      error: () => inboxCurrent().error,
      sync: syncInbox,
    },
    saved: {
      rules,
      projects,
      state: () => savedCurrent().state,
      error: () => savedCurrent().error,
      removing: (ruleID) => {
        const submitting = mutationState().submitting;
        return submitting?.kind === "saved" && submitting.ruleID === ruleID;
      },
      errorFor: (ruleID) => {
        const errors = mutationState().savedErrors;
        for (const project of projects()) {
          const error = errors.get(savedKey(project.id, ruleID));
          if (error) return error;
        }
        return undefined;
      },
      sync: syncSaved,
      remove: (ruleID) => effects.runPromise(revoke(ruleID)),
    },
  };
}
