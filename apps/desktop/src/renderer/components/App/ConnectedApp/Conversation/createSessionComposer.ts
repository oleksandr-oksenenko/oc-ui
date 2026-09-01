import { createSessionDraftStore } from "../../../../domain/index.ts";
import type { ReviewDraftKey, ReviewDraftStore } from "../../../../domain/index.ts";
import { createCodeReviewPrompt } from "../../../../opencode/code-review.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";

import type { ComposerReview } from "./SessionPane/Composer.tsx";

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
  readonly review: {
    readonly drafts: ReviewDraftStore;
    readonly key: Accessor<ReviewDraftKey | undefined>;
    readonly requestDiscard: (
      key: ReviewDraftKey,
      count: number,
      opener: HTMLButtonElement,
    ) => void;
  };
};

export type SessionComposerController = {
  readonly value: Accessor<string>;
  readonly disabled: Accessor<boolean>;
  readonly submitting: Accessor<boolean>;
  readonly error: Accessor<string | undefined>;
  readonly review: Accessor<ComposerReview | undefined>;
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

  const activeReviewKey = (): ReviewDraftKey | undefined => {
    const sessionID = options.selectedID();
    const key = options.review.key();
    return sessionID !== undefined && key?.sessionID === sessionID ? key : undefined;
  };

  const review = createMemo<ComposerReview | undefined>(() => {
    const key = activeReviewKey();
    if (key === undefined) return undefined;
    const comments = options.review.drafts
      .get(key)
      .comments.filter((comment) => comment.body.trim() !== "");
    if (comments.length === 0) return undefined;
    const discard = (opener: HTMLButtonElement): void =>
      options.review.requestDiscard(key, comments.length, opener);
    return { count: comments.length, onDiscard: discard };
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
    const key = activeReviewKey();
    const reviewSnapshot = key === undefined ? undefined : options.review.drafts.capture(key);
    const reviewComments = reviewSnapshot?.comments ?? [];
    if (text.trim() === "" && reviewComments.length === 0) return;

    const prompt =
      reviewSnapshot && reviewComments.length > 0
        ? createCodeReviewPrompt({ instruction: text, comments: reviewComments })
        : { text };

    setPromptError(undefined);
    setSubmittingID(sessionID);
    try {
      await options.runtime.data.session.prompt({ sessionID, ...prompt });
      drafts.clearIfUnchanged(sessionID, text);
      if (reviewSnapshot !== undefined && reviewComments.length > 0) {
        options.review.drafts.clearIfUnchanged(reviewSnapshot);
      }
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
    review,
    input,
    submit,
    clear: drafts.clear,
  };
}
