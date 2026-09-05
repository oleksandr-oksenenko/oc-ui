import { useAtomValue } from "@effect/atom-solid";
import { Cause, Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { FormAnswer, LocationRef } from "@opencode-ai/client";
import type { Data, FormWithLocation } from "@opencode-ai/client/solid";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

type FormControllerState = "loading" | "ready" | "failed";

type FormControllerInput = {
  readonly effects: WorkspaceOwner;
  readonly connected: Accessor<boolean>;
  readonly sessionID: Accessor<string | undefined>;
  readonly location?: LocationRef;
  readonly form: Pick<Data["session"]["form"], "list" | "sync" | "reply" | "cancel">;
  readonly errorMessage: (kind: "sync" | "reply" | "cancel", cause: unknown) => string;
};

type FormController = {
  readonly forms: Accessor<readonly FormWithLocation[]>;
  readonly state: Accessor<FormControllerState>;
  readonly error: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly startSync: () => void;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<boolean>;
  readonly cancel: (formID: string) => Promise<boolean>;
};

type MutationKind = "reply" | "cancel";

const mutationKey = (sessionID: string, formID: string): string => `${sessionID}\u0000${formID}`;

/** Shared lifecycle and mutation state for session-scoped and location-scoped forms. */
export function createFormController(input: FormControllerInput): FormController {
  const { effects } = input;
  const status = Atom.make<{ state: FormControllerState; error?: string }>({
    state: input.sessionID() !== undefined && input.connected() ? "loading" : "ready",
  });
  const mutations = Atom.make<ReadonlyMap<string, { pending: boolean; error?: string }>>(new Map());
  effects.mount(status);
  effects.mount(mutations);
  const current = useAtomValue(() => status);
  const mutationState = useAtomValue(() => mutations);
  const read = effects.latest();
  let selection: object | undefined = {};

  const forms = createMemo<readonly FormWithLocation[]>(() => {
    current();
    const sessionID = input.sessionID();
    return sessionID === undefined ? [] : (input.form.list(sessionID, input.location) ?? []);
  });

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

  const mutation = (formID: string) => {
    const sessionID = input.sessionID();
    return sessionID === undefined
      ? undefined
      : mutationState().get(mutationKey(sessionID, formID));
  };
  const pending = createMemo(() => {
    const sessionID = input.sessionID();
    if (sessionID === undefined) return false;
    const prefix = `${sessionID}\u0000`;
    return [...mutationState()].some(([key, value]) => key.startsWith(prefix) && value.pending);
  });
  const updateMutation = (key: string, value: { pending: boolean; error?: string }) => {
    effects.registry.set(mutations, new Map(effects.registry.get(mutations)).set(key, value));
  };

  const mutate = Effect.fn("forms.mutate")(function* (
    formID: string,
    kind: MutationKind,
    answer?: FormAnswer,
  ) {
    const sessionID = input.sessionID();
    const initiatingSelection = selection;
    if (
      !initiatingSelection ||
      sessionID === undefined ||
      !input.connected() ||
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
  onCleanup(() => {
    selection = undefined;
    read.cancel();
  });

  return {
    forms,
    state: () => current().state,
    error: () => current().error,
    pending,
    submitting: (formID) => mutation(formID)?.pending ?? false,
    errorFor: (formID) => mutation(formID)?.error,
    sync,
    startSync: startRefresh,
    reply: (formID, answer) => effects.runPromise(mutate(formID, "reply", answer)),
    cancel: (formID) => effects.runPromise(mutate(formID, "cancel")),
  };
}
