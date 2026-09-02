import type { FormAnswer, LocationRef } from "@opencode-ai/client";
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";

export type FormControllerForm = {
  readonly id: string;
  readonly sessionID: string;
};

type FormControllerState = "loading" | "ready" | "failed";

export type FormControllerInput<Form extends FormControllerForm> = {
  readonly connected: Accessor<boolean>;
  readonly sessionID: Accessor<string | undefined>;
  readonly location?: LocationRef;
  readonly list: (sessionID: string, location?: LocationRef) => readonly Form[] | undefined;
  readonly sync: (sessionID: string, location?: LocationRef) => Promise<void>;
  readonly reply: (
    input: { readonly sessionID: string; readonly formID: string; readonly answer: FormAnswer },
    location?: LocationRef,
  ) => Promise<void>;
  readonly cancel: (
    input: { readonly sessionID: string; readonly formID: string },
    location?: LocationRef,
  ) => Promise<void>;
  readonly errorMessage: (kind: "sync" | "reply" | "cancel", cause: unknown) => string;
};

export type FormController<Form extends FormControllerForm> = {
  readonly forms: Accessor<readonly Form[]>;
  readonly state: Accessor<FormControllerState>;
  readonly error: Accessor<string | undefined>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<boolean>;
  readonly cancel: (formID: string) => Promise<boolean>;
};

type MutationKind = "reply" | "cancel";

const mutationKey = (sessionID: string, formID: string): string => `${sessionID}\u0000${formID}`;

/**
 * Shared lifecycle and mutation state for session-scoped and location-scoped forms.
 * Adapters supply the client methods because the client has optional location arguments.
 */
export function createFormController<Form extends FormControllerForm>(
  input: FormControllerInput<Form>,
): FormController<Form> {
  const selectedAtStart = input.sessionID();
  const [state, setState] = createSignal<FormControllerState>(
    selectedAtStart !== undefined && input.connected() ? "loading" : "ready",
  );
  const [error, setError] = createSignal<string>();
  const [formsVersion, setFormsVersion] = createSignal(0);
  const [mutationVersion, setMutationVersion] = createSignal(0);

  const pendingMutations = new Set<string>();
  const mutationErrors = new Map<string, string>();
  let scopeGeneration = 0;
  let syncGeneration = 0;
  let alive = true;
  let previouslyConnected = input.connected();

  const forms = createMemo<readonly Form[]>(() => {
    formsVersion();
    const sessionID = input.sessionID();
    return sessionID === undefined ? [] : (input.list(sessionID, input.location) ?? []);
  });

  const isCurrent = (sessionID: string, generation: number, run: number): boolean =>
    alive &&
    scopeGeneration === generation &&
    syncGeneration === run &&
    input.sessionID() === sessionID;

  const hasForm = (sessionID: string, formID: string): boolean =>
    input.list(sessionID, input.location)?.some((form) => form.id === formID) === true;

  const sync = async (): Promise<void> => {
    const run = ++syncGeneration;
    const sessionID = input.sessionID();
    const generation = scopeGeneration;

    if (!alive) return;
    if (sessionID === undefined) {
      setError(undefined);
      setState("ready");
      return;
    }
    if (!input.connected()) {
      setError(undefined);
      setState("ready");
      return;
    }

    setError(undefined);
    setState("loading");
    try {
      await input.sync(sessionID, input.location);
      if (!isCurrent(sessionID, generation, run)) return;
      setFormsVersion((version) => version + 1);
      setState("ready");
    } catch (cause) {
      if (!isCurrent(sessionID, generation, run)) return;
      setError(input.errorMessage("sync", cause));
      setState("failed");
    }
  };

  const clearMutationErrors = (): void => {
    if (mutationErrors.size === 0) return;
    mutationErrors.clear();
    setMutationVersion((version) => version + 1);
  };

  const submitting = (formID: string): boolean => {
    mutationVersion();
    const sessionID = input.sessionID();
    return sessionID !== undefined && pendingMutations.has(mutationKey(sessionID, formID));
  };

  const pending = createMemo(() => {
    mutationVersion();
    const sessionID = input.sessionID();
    if (sessionID === undefined) return false;
    const prefix = `${sessionID}\u0000`;
    for (const key of pendingMutations) if (key.startsWith(prefix)) return true;
    return false;
  });

  const errorFor = (formID: string): string | undefined => {
    mutationVersion();
    const sessionID = input.sessionID();
    return sessionID === undefined ? undefined : mutationErrors.get(mutationKey(sessionID, formID));
  };

  const mutate = async (
    formID: string,
    kind: MutationKind,
    answer?: FormAnswer,
  ): Promise<boolean> => {
    const sessionID = input.sessionID();
    if (sessionID === undefined || !input.connected() || !hasForm(sessionID, formID)) return false;

    const key = mutationKey(sessionID, formID);
    if (pendingMutations.has(key)) return false;
    pendingMutations.add(key);
    mutationErrors.delete(key);
    setMutationVersion((version) => version + 1);
    const generation = scopeGeneration;

    const run = async (): Promise<boolean> => {
      if (!alive) {
        pendingMutations.delete(key);
        return false;
      }
      try {
        if (kind === "reply") {
          await input.reply({ sessionID, formID, answer: answer ?? {} }, input.location);
        } else {
          await input.cancel({ sessionID, formID }, input.location);
        }
        return true;
      } catch (cause) {
        if (alive && scopeGeneration === generation && input.sessionID() === sessionID) {
          const message = input.errorMessage(kind, cause);
          mutationErrors.set(key, message);
          setMutationVersion((version) => version + 1);
        }
        return false;
      } finally {
        pendingMutations.delete(key);
        setMutationVersion((version) => version + 1);
      }
    };

    return run();
  };

  createEffect(
    on(
      input.sessionID,
      (sessionID) => {
        scopeGeneration += 1;
        clearMutationErrors();
        if (sessionID === undefined) {
          setError(undefined);
          setState("ready");
          return;
        }
        void sync();
      },
      { defer: false },
    ),
  );

  createEffect(
    on(
      input.connected,
      (connected) => {
        if (!connected) {
          if (previouslyConnected) {
            scopeGeneration += 1;
            syncGeneration += 1;
            setError(undefined);
            setState("ready");
          }
          previouslyConnected = false;
          return;
        }
        if (!previouslyConnected) void sync();
        previouslyConnected = true;
      },
      { defer: false },
    ),
  );

  onCleanup(() => {
    alive = false;
    scopeGeneration += 1;
    syncGeneration += 1;
  });

  return {
    forms,
    state,
    error,
    pending,
    submitting,
    errorFor,
    sync,
    reply: (formID, answer) => mutate(formID, "reply", answer),
    cancel: (formID) => mutate(formID, "cancel"),
  };
}
