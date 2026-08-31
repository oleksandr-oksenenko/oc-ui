import type { FormAnswer, FormInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";

type SessionFormsData = {
  readonly on: Data["on"];
  readonly session: {
    readonly form: Pick<
      Data["session"]["form"],
      "list" | "sync" | "invalidate" | "reply" | "cancel"
    >;
  };
};

type SessionFormsInput = {
  readonly data: SessionFormsData;
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
};

type SessionFormsState = "loading" | "ready" | "failed";

export type SessionFormsController = {
  readonly sessionForms: Accessor<readonly FormInfo[]>;
  readonly state: Accessor<SessionFormsState>;
  readonly error: Accessor<string | undefined>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<void>;
  readonly cancel: (formID: string) => Promise<void>;
};

const SYNC_FAILURE_MESSAGE = "Forms could not be refreshed. Try again.";
const REPLY_FAILURE_MESSAGE = "The form could not be submitted. Try again.";
const CANCEL_FAILURE_MESSAGE = "The form could not be cancelled. Try again.";

const mutationKey = (sessionID: string, formID: string): string => `${sessionID}\u0000${formID}`;

/** Owns pending forms for the selected session and their server mutations. */
export function createSessionForms(input: SessionFormsInput): SessionFormsController {
  const [state, setState] = createSignal<SessionFormsState>(
    input.selectedID() === undefined ? "ready" : "loading",
  );
  const [syncError, setSyncError] = createSignal<string>();
  const [mutationRevision, setMutationRevision] = createSignal(0);
  const inFlight = new Set<string>();
  const mutationErrors = new Map<string, string>();

  let selection = 0;
  let connectionGeneration = 0;
  let alive = true;
  let latestSyncRun = 0;

  const sessionForms = createMemo<readonly FormInfo[]>(() => {
    const sessionID = input.selectedID();
    return sessionID === undefined ? [] : (input.data.session.form.list(sessionID) ?? []);
  });

  const isCurrent = (
    sessionID: string,
    generation: number,
    requestConnection = connectionGeneration,
  ): boolean =>
    alive &&
    input.connected() &&
    connectionGeneration === requestConnection &&
    selection === generation &&
    input.selectedID() === sessionID;

  const hasForm = (sessionID: string, formID: string): boolean =>
    input.data.session.form.list(sessionID)?.some((form) => form.id === formID) === true;

  const sync = async (): Promise<void> => {
    const run = ++latestSyncRun;
    const sessionID = input.selectedID();
    const generation = selection;
    const requestConnection = connectionGeneration;

    if (!alive) return;
    if (sessionID === undefined) {
      setSyncError(undefined);
      setState("ready");
      return;
    }
    if (!input.connected()) {
      setSyncError(undefined);
      setState("ready");
      return;
    }

    setSyncError(undefined);
    setState("loading");
    try {
      await input.data.session.form.sync(sessionID);
      if (isCurrent(sessionID, generation, requestConnection) && latestSyncRun === run) {
        setState("ready");
      }
    } catch {
      if (isCurrent(sessionID, generation, requestConnection) && latestSyncRun === run) {
        setSyncError(SYNC_FAILURE_MESSAGE);
        setState("failed");
      }
    }
  };

  const clearMutationState = (): void => {
    if (mutationErrors.size === 0) return;
    mutationErrors.clear();
    setMutationRevision((revision) => revision + 1);
  };

  const setMutationInFlight = (key: string, value: boolean): void => {
    if (value) inFlight.add(key);
    else inFlight.delete(key);
    setMutationRevision((revision) => revision + 1);
  };

  const submitting = (formID: string): boolean => {
    mutationRevision();
    const sessionID = input.selectedID();
    return sessionID !== undefined && inFlight.has(mutationKey(sessionID, formID));
  };

  const errorFor = (formID: string): string | undefined => {
    mutationRevision();
    const sessionID = input.selectedID();
    return sessionID === undefined ? undefined : mutationErrors.get(mutationKey(sessionID, formID));
  };

  const mutate = async (
    formID: string,
    operation: () => Promise<void>,
    failureMessage: string,
  ): Promise<void> => {
    const sessionID = input.selectedID();
    if (sessionID === undefined || !input.connected() || !hasForm(sessionID, formID)) {
      return;
    }

    const key = mutationKey(sessionID, formID);
    if (inFlight.has(key)) return;
    mutationErrors.delete(key);
    setMutationInFlight(key, true);
    const generation = selection;
    const requestConnection = connectionGeneration;

    try {
      await operation();
    } catch {
      if (isCurrent(sessionID, generation, requestConnection) && hasForm(sessionID, formID)) {
        mutationErrors.set(key, failureMessage);
        setMutationRevision((revision) => revision + 1);
      }
    } finally {
      if (alive) setMutationInFlight(key, false);
    }
  };

  const reply = (formID: string, answer: FormAnswer): Promise<void> => {
    const sessionID = input.selectedID();
    if (sessionID === undefined) return Promise.resolve();
    return mutate(
      formID,
      () => input.data.session.form.reply({ sessionID, formID, answer }),
      REPLY_FAILURE_MESSAGE,
    );
  };

  const cancel = (formID: string): Promise<void> => {
    const sessionID = input.selectedID();
    if (sessionID === undefined) return Promise.resolve();
    return mutate(
      formID,
      () => input.data.session.form.cancel({ sessionID, formID }),
      CANCEL_FAILURE_MESSAGE,
    );
  };

  createEffect(
    on(
      input.selectedID,
      () => {
        selection += 1;
        clearMutationState();
        void sync();
      },
      { defer: false },
    ),
  );

  createEffect(
    on(
      input.connected,
      (connected, previous) => {
        if (!connected && previous !== false) {
          connectionGeneration += 1;
        }
      },
      { defer: false },
    ),
  );

  const stopCreated = input.data.on("form.created", (event) => {
    const sessionID = event.data.form.sessionID;
    if (sessionID === "global") return;
    input.data.session.form.invalidate(sessionID);
    if (sessionID === input.selectedID()) void sync();
  });

  onCleanup(() => {
    alive = false;
    selection += 1;
    stopCreated();
  });

  return {
    sessionForms,
    state,
    error: syncError,
    submitting,
    errorFor,
    sync,
    reply,
    cancel,
  };
}
