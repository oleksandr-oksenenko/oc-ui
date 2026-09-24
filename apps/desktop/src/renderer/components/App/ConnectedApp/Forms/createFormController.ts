import { useAtomValue } from "@effect/atom-solid";
import { Cause, Effect, Fiber, Semaphore } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { FormAnswer, LocationRef } from "@opencode/client";
import type { Data, FormWithLocation } from "@opencode/client/solid";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

type FormControllerState = "loading" | "ready" | "failed";

type FormControllerInput = {
  readonly effects: WorkspaceOwner;
  readonly connected: Accessor<boolean>;
  readonly sessionID: Accessor<string | undefined>;
  /** Extra sessions, in display order, whose forms are shown without owning the status. */
  readonly relatedIDs?: Accessor<readonly string[]>;
  readonly location?: LocationRef;
  readonly form: Pick<Data["session"]["form"], "list" | "sync" | "reply" | "cancel">;
  readonly errorMessage: (kind: "sync" | "reply" | "cancel", cause: unknown) => string;
};

type FormController = {
  readonly forms: Accessor<readonly FormWithLocation[]>;
  readonly state: Accessor<FormControllerState>;
  readonly error: Accessor<string | undefined>;
  /** Set when a related session's forms could not be loaded. */
  readonly relatedError: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (sessionID: string, formID: string) => boolean;
  readonly errorFor: (sessionID: string, formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly startSync: () => void;
  readonly syncSession: (sessionID: string) => void;
  readonly retryRelated: () => Promise<void>;
  readonly reply: (sessionID: string, formID: string, answer: FormAnswer) => Promise<boolean>;
  readonly cancel: (sessionID: string, formID: string) => Promise<boolean>;
};

type MutationKind = "reply" | "cancel";

const mutationKey = (sessionID: string, formID: string): string => `${sessionID}\u0000${formID}`;
const RELATED_LOAD_FAILURE = "Some subagent questions could not be loaded.";

/** Shared lifecycle and mutation state for session-scoped and location-scoped forms. */
export function createFormController(input: FormControllerInput): FormController {
  const { effects } = input;
  const status = Atom.make<{ state: FormControllerState; error?: string }>({
    state: input.sessionID() !== undefined && input.connected() ? "loading" : "ready",
  });
  const mutations = Atom.make<ReadonlyMap<string, { pending: boolean; error?: string }>>(new Map());
  const relatedFailures = Atom.make(new Set<string>());
  effects.mount(status);
  effects.mount(mutations);
  effects.mount(relatedFailures);
  const current = useAtomValue(() => status);
  const mutationState = useAtomValue(() => mutations);
  const relatedFailureSet = useAtomValue(() => relatedFailures);
  const read = effects.latest();
  const relatedRead = effects.latest();
  const relatedPermits = Semaphore.makeUnsafe(4);
  let selection: object | undefined = {};

  const activeSessionIDs = (): readonly string[] => {
    const sessionID = input.sessionID();
    if (sessionID === undefined) return [];
    return [sessionID, ...(input.relatedIDs?.() ?? []).filter((related) => related !== sessionID)];
  };
  const relatedSessionIDs = (): readonly string[] => activeSessionIDs().slice(1);

  const forms = createMemo<readonly FormWithLocation[]>(() => {
    current();
    return activeSessionIDs().flatMap(
      (sessionID) => input.form.list(sessionID, input.location) ?? [],
    );
  });

  const setRelatedFailure = (sessionID: string, failed: boolean) => {
    if (failed && !relatedSessionIDs().includes(sessionID)) return;
    const currentFailures = effects.registry.get(relatedFailures);
    if (currentFailures.has(sessionID) === failed) return;
    const next = new Set(currentFailures);
    if (failed) next.add(sessionID);
    else next.delete(sessionID);
    effects.registry.set(relatedFailures, next);
  };

  const syncRelatedSession = Effect.fn("forms.syncRelatedSession")(function* (sessionID: string) {
    const synced = yield* effects
      .request(() => input.form.sync(sessionID, input.location))
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    setRelatedFailure(sessionID, !synced);
    return synced;
  });

  /** Re-checks ownership after a permit is granted so departed sessions stop queuing work. */
  const syncRelatedNow = (sessionID: string) =>
    Effect.suspend(() =>
      input.connected() && relatedSessionIDs().includes(sessionID)
        ? syncRelatedSession(sessionID)
        : Effect.void,
    );

  /** Bounds related reads; every related session shares the same permit pool. */
  const syncRelatedBatch = (sessionIDs: readonly string[]) =>
    Effect.forEach(
      sessionIDs,
      (sessionID) => relatedPermits.withPermits(1)(syncRelatedNow(sessionID)),
      { concurrency: "unbounded", discard: true },
    );

  const missingRelated = (sessionIDs: readonly string[]) =>
    sessionIDs.filter((sessionID) => input.form.list(sessionID, input.location) === undefined);

  const pruneRelatedFailures = (sessionIDs: readonly string[]) => {
    const active = new Set(sessionIDs);
    const currentFailures = effects.registry.get(relatedFailures);
    if ([...currentFailures].every((sessionID) => active.has(sessionID))) return;
    effects.registry.set(
      relatedFailures,
      new Set([...currentFailures].filter((sessionID) => active.has(sessionID))),
    );
  };

  const retryRelated = (): Promise<void> => {
    if (!input.connected()) return Promise.resolve();
    const related = relatedSessionIDs();
    const failed = [...effects.registry.get(relatedFailures)].filter((sessionID) =>
      related.includes(sessionID),
    );
    if (failed.length === 0) return Promise.resolve();
    // Unions with still-unloaded caches so recovery never discards queued hydration.
    const targets = [...new Set([...failed, ...missingRelated(related)])];
    return effects.runPromise(
      Fiber.join(relatedRead.run(syncRelatedBatch(targets))).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
      ),
    );
  };

  const refresh = Effect.fn("forms.refresh")(function* () {
    const sessionID = input.sessionID();
    if (sessionID === undefined || !input.connected()) {
      effects.registry.set(status, { state: "ready" });
      return;
    }
    effects.registry.set(status, { state: "loading" });
    yield* effects
      .request(() => input.form.sync(sessionID, input.location))
      .pipe(
        Effect.match({
          onSuccess: () => effects.registry.set(status, { state: "ready" }),
          onFailure: (failure) =>
            effects.registry.set(status, {
              state: "failed",
              error: input.errorMessage("sync", failure.cause),
            }),
        }),
      );
  });

  const startRefresh = () => read.run(selection ? refresh() : Effect.void);
  const sync = (): Promise<void> =>
    effects.runPromise(
      Fiber.join(startRefresh()).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
      ),
    );
  const syncSession = (sessionID: string) => {
    effects.runFork(Effect.ignore(relatedPermits.withPermits(1)(syncRelatedNow(sessionID))));
  };

  const mutation = (sessionID: string, formID: string) =>
    mutationState().get(mutationKey(sessionID, formID));
  const pending = createMemo(() => {
    const sessionIDs = activeSessionIDs();
    if (sessionIDs.length === 0) return false;
    return [...mutationState()].some(
      ([key, value]) =>
        value.pending && sessionIDs.some((sessionID) => key.startsWith(`${sessionID}\u0000`)),
    );
  });
  const updateMutation = (key: string, value: { pending: boolean; error?: string }) => {
    effects.registry.set(mutations, new Map(effects.registry.get(mutations)).set(key, value));
  };

  const mutate = Effect.fn("forms.mutate")(function* (
    sessionID: string,
    formID: string,
    kind: MutationKind,
    answer?: FormAnswer,
  ) {
    const initiatingSelection = selection;
    if (
      !initiatingSelection ||
      !input.connected() ||
      !activeSessionIDs().includes(sessionID) ||
      !input.form.list(sessionID, input.location)?.some((form) => form.id === formID)
    )
      return false;
    const key = mutationKey(sessionID, formID);
    if (effects.registry.get(mutations).get(key)?.pending) return false;
    updateMutation(key, { pending: true });
    return yield* effects
      .request(() =>
        kind === "reply"
          ? input.form.reply({ sessionID, formID, answer: answer ?? {} }, input.location)
          : input.form.cancel({ sessionID, formID }, input.location),
      )
      .pipe(
        Effect.match({
          onSuccess: () => true,
          onFailure: (failure) => {
            if (selection === initiatingSelection) {
              updateMutation(key, {
                pending: true,
                error: input.errorMessage(kind, failure.cause),
              });
            }
            return false;
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            const error = effects.registry.get(mutations).get(key)?.error;
            const next = new Map(effects.registry.get(mutations));
            if (error) next.set(key, { pending: false, error });
            else next.delete(key);
            effects.registry.set(mutations, next);
          }),
        ),
      );
  });

  createEffect(
    on([input.sessionID, input.connected], () => {
      selection = {};
      effects.registry.set(
        mutations,
        new Map(
          [...effects.registry.get(mutations)]
            .filter(([, value]) => value.pending)
            .map(([key]) => [key, { pending: true }]),
        ),
      );
      startRefresh();
    }),
  );
  const relatedSessions = createMemo(() => input.relatedIDs?.() ?? [], undefined, {
    equals: (previous, next) =>
      previous.length === next.length &&
      previous.every((sessionID, index) => sessionID === next[index]),
  });
  createEffect(
    on([relatedSessions, input.connected, input.sessionID], ([, connected]) => {
      const related = relatedSessionIDs();
      if (!connected) {
        relatedRead.run(Effect.void);
        return;
      }
      pruneRelatedFailures(related);
      relatedRead.run(syncRelatedBatch(missingRelated(related)));
    }),
  );
  onCleanup(() => {
    selection = undefined;
    read.cancel();
    relatedRead.cancel();
  });

  return {
    forms,
    state: () => current().state,
    error: () => current().error,
    relatedError: () => {
      if (!input.connected()) return undefined;
      const related = new Set(relatedSessionIDs());
      return [...relatedFailureSet()].some((sessionID) => related.has(sessionID))
        ? RELATED_LOAD_FAILURE
        : undefined;
    },
    pending,
    submitting: (sessionID, formID) => mutation(sessionID, formID)?.pending ?? false,
    errorFor: (sessionID, formID) => mutation(sessionID, formID)?.error,
    sync,
    startSync: startRefresh,
    syncSession,
    retryRelated,
    reply: (sessionID, formID, answer) =>
      effects.runPromise(mutate(sessionID, formID, "reply", answer)),
    cancel: (sessionID, formID) => effects.runPromise(mutate(sessionID, formID, "cancel")),
  };
}
