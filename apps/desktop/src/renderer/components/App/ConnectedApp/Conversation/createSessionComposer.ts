import { SessionMessage } from "@opencode-ai/schema";
import { createSessionDraftStore } from "../../../../domain/index.ts";
import type {
  AnnotationDraftSnapshot,
  AnnotationDraftStore,
  ReviewDraftKey,
  ReviewDraftStore,
} from "../../../../domain/index.ts";
import { createSessionPrompt } from "../../../../opencode/session-prompt.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import type { ComposerReview } from "./SessionPane/Composer.tsx";

const PROMPT_FAILURE_MESSAGE =
  "Couldn't confirm the message was sent. Your draft has been restored.";

type SessionPrompt = ReturnType<typeof createSessionPrompt>;

type SubmissionRequest = {
  readonly sessionID: string;
  readonly id: string;
  readonly prompt: SessionPrompt;
  readonly text: string;
  readonly reviewSnapshot: ReturnType<ReviewDraftStore["capture"]> | undefined;
  readonly annotations: AnnotationDraftSnapshot;
};

type SessionComposerOptions = {
  readonly runtime: {
    readonly data: {
      readonly session: Pick<ConnectedRuntime["data"]["session"], "prompt"> & {
        readonly message: Pick<ConnectedRuntime["data"]["session"]["message"], "get">;
      };
    };
  };
  readonly selectedID: Accessor<string | undefined>;
  readonly running: Accessor<boolean>;
  readonly transcriptLoading: Accessor<boolean>;
  readonly transcriptError: Accessor<string | undefined>;
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
  readonly annotations: AnnotationDraftStore;
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
  const [activeRequest, setActiveRequest] = createSignal<SubmissionRequest>();
  const [errorRequest, setErrorRequest] = createSignal<SubmissionRequest>();
  const failedRequests = new Map<string, SubmissionRequest>();
  let disposed = false;

  createEffect(() => {
    options.selectedID();
    setErrorRequest(undefined);
  });

  const value = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID === undefined ? "" : drafts.get(sessionID);
  });

  const disabled = createMemo(
    () =>
      !options.connected() ||
      options.transcriptLoading() ||
      options.transcriptError() !== undefined ||
      activeRequest() !== undefined ||
      options.running() ||
      options.selectionSwitching(),
  );

  const submitting = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID !== undefined && activeRequest()?.sessionID === sessionID;
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
    if (sessionID === undefined) return;
    drafts.set(sessionID, nextValue);
  };

  const isSubmissionAllowed = (sessionID: string | undefined): sessionID is string =>
    sessionID !== undefined && !disabled();

  const captureDraft = (sessionID: string) => {
    const text = drafts.get(sessionID);
    const key = activeReviewKey();
    const reviewCapture = key === undefined ? undefined : options.review.drafts.capture(key);
    const reviewComments = reviewCapture?.comments ?? [];
    const reviewSnapshot = reviewComments.length > 0 ? reviewCapture : undefined;
    const annotationComments = options.annotations
      .get(sessionID)
      .filter((comment) => comment.body.trim() !== "");
    if (text.trim() === "" && reviewComments.length === 0 && annotationComments.length === 0) {
      return undefined;
    }
    return { text, reviewSnapshot, reviewComments, annotationComments };
  };

  const submit = async (): Promise<void> => {
    const sessionID = options.selectedID();
    if (!isSubmissionAllowed(sessionID)) return;
    const captured = captureDraft(sessionID);
    if (captured === undefined) return;
    const { text, reviewSnapshot, reviewComments, annotationComments } = captured;

    const retry = failedRequests.get(sessionID);
    const candidatePrompt = createSessionPrompt({
      instruction: text,
      reviewComments,
      annotations: annotationComments,
    });
    const retrying = retry !== undefined && samePrompt(candidatePrompt, retry.prompt);
    if (retry !== undefined && !retrying) forgetFailedRequest(retry);
    const annotationSnapshot = options.annotations.take(sessionID);

    const request: SubmissionRequest = {
      sessionID,
      id: retrying ? retry.id : SessionMessage.ID.create(),
      prompt: retrying ? retry.prompt : candidatePrompt,
      text,
      reviewSnapshot,
      annotations: annotationSnapshot,
    };

    setErrorRequest(undefined);
    failedRequests.delete(sessionID);
    setActiveRequest(request);
    try {
      await options.runtime.data.session.prompt({ sessionID, id: request.id, ...request.prompt });
      completeSubmission(request);
    } catch {
      if (disposed || activeRequest() !== request) return;

      // The SDK has completed its rollback before its prompt promise rejects.
      // A retained matching row means a durable echo won the response race.
      if (matchingMessage(request)) {
        completeSubmission(request);
        return;
      }
      restoreFailed(request);
    } finally {
      if (activeRequest() === request) {
        setActiveRequest(undefined);
      }
    }
  };

  // A durable echo may arrive after the SDK restored our draft. The row itself
  // is the authority; the failed request only supplies the exact identity and
  // payload to match. A retry is excluded while it has an active owner.
  createEffect(() => {
    const active = activeRequest();
    for (const request of failedRequests.values()) {
      if (request === active || !matchingMessage(request)) continue;
      completeSubmission(request);
    }
  });

  const clear = (sessionID: string): void => {
    drafts.clear(sessionID);
    options.annotations.clear(sessionID);
    options.review.drafts.clearSession(sessionID);
    const failed = failedRequests.get(sessionID);
    if (failed !== undefined) forgetFailedRequest(failed);
    if (activeRequest()?.sessionID === sessionID) {
      setActiveRequest(undefined);
    }
  };

  onCleanup(() => {
    disposed = true;
    setActiveRequest(undefined);
    failedRequests.clear();
  });

  return {
    value,
    disabled,
    submitting,
    error: () => (errorRequest() === undefined ? undefined : PROMPT_FAILURE_MESSAGE),
    review,
    input,
    submit,
    clear,
  };

  function completeSubmission(request: SubmissionRequest): void {
    if (disposed) return;
    if (activeRequest() !== request && failedRequests.get(request.sessionID) !== request) {
      return;
    }
    if (failedRequests.get(request.sessionID) === request) {
      options.annotations.clearIfUnchanged(request.annotations);
    }
    drafts.clearIfUnchanged(request.sessionID, request.text);
    if (request.reviewSnapshot !== undefined) {
      options.review.drafts.clearIfUnchanged(request.reviewSnapshot);
    }
    if (failedRequests.get(request.sessionID) === request) {
      failedRequests.delete(request.sessionID);
    }
    if (errorRequest() === request) setErrorRequest(undefined);
    if (activeRequest() === request) {
      setActiveRequest(undefined);
    }
  }

  function matchingMessage(request: SubmissionRequest): boolean {
    const message = options.runtime.data.session.message.get(request.sessionID, request.id);
    return (
      message?.type === "user" &&
      message.text === request.prompt.text &&
      sameValue(message.metadata, request.prompt.metadata)
    );
  }

  function forgetFailedRequest(request: SubmissionRequest): void {
    if (failedRequests.get(request.sessionID) !== request) return;
    failedRequests.delete(request.sessionID);
    if (errorRequest() === request) setErrorRequest(undefined);
  }

  function restoreFailed(request: SubmissionRequest): void {
    options.annotations.restore(request.annotations);
    failedRequests.set(request.sessionID, request);
    if (options.selectedID() === request.sessionID) setErrorRequest(request);
    setActiveRequest(undefined);
  }
}

function samePrompt(left: SessionPrompt, right: SessionPrompt): boolean {
  return left.text === right.text && sameValue(left.metadata, right.metadata);
}

function sameValue<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
