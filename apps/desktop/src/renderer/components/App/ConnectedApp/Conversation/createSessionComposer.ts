import { createSessionDraftStore } from "../../../../domain/index.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";

const PROMPT_FAILURE_MESSAGE = "The prompt was not admitted. Your draft has been kept.";

type SessionComposerOptions = {
  readonly runtime: {
    readonly data: {
      readonly session: Pick<ConnectedRuntime["data"]["session"], "prompt">;
    };
  };
  readonly selectedID: Accessor<string | undefined>;
  readonly running: Accessor<boolean>;
  readonly transcriptLoading: Accessor<boolean>;
  readonly connected: Accessor<boolean>;
  readonly selectionSwitching: Accessor<boolean>;
};

export type SessionComposerController = {
  readonly value: Accessor<string>;
  readonly disabled: Accessor<boolean>;
  readonly submitting: Accessor<boolean>;
  readonly error: Accessor<string | undefined>;
  readonly input: (value: string) => void;
  readonly submit: () => Promise<void>;
  readonly clear: (sessionID: string) => void;
};

/** Owns session drafts and prompt admission for the selected conversation. */
export function createSessionComposer(options: SessionComposerOptions): SessionComposerController {
  const drafts = createSessionDraftStore();
  const [submittingID, setSubmittingID] = createSignal<string>();
  const [promptError, setPromptError] = createSignal<string>();

  createEffect(() => {
    options.selectedID();
    setPromptError(undefined);
  });

  const value = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID === undefined ? "" : drafts.get(sessionID);
  });

  const disabled = createMemo(
    () =>
      !options.connected() ||
      options.transcriptLoading() ||
      submittingID() !== undefined ||
      options.running() ||
      options.selectionSwitching(),
  );

  const submitting = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID !== undefined && submittingID() === sessionID;
  });

  const input = (nextValue: string): void => {
    const sessionID = options.selectedID();
    if (sessionID !== undefined) drafts.set(sessionID, nextValue);
  };

  const submit = async (): Promise<void> => {
    const sessionID = options.selectedID();
    if (
      sessionID === undefined ||
      submittingID() !== undefined ||
      options.running() ||
      !options.connected() ||
      options.selectionSwitching()
    ) {
      return;
    }

    const text = drafts.get(sessionID);
    if (text.trim() === "") return;

    setPromptError(undefined);
    setSubmittingID(sessionID);
    try {
      await options.runtime.data.session.prompt({ sessionID, text });
      drafts.clearIfUnchanged(sessionID, text);
    } catch {
      if (options.selectedID() === sessionID) setPromptError(PROMPT_FAILURE_MESSAGE);
    } finally {
      setSubmittingID(undefined);
    }
  };

  return {
    value,
    disabled,
    submitting,
    error: promptError,
    input,
    submit,
    clear: drafts.clear,
  };
}
