import { useAtomValue } from "@effect/atom-solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { SessionInboxDelivery } from "@opencode-ai/client";
import { SessionMessage } from "@opencode-ai/schema";
import { createSessionDraftStore } from "../../../../domain/index.ts";
import type {
  AnnotationDraftSnapshot,
  AnnotationDraftStore,
  ReviewDraftKey,
  ReviewDraftStore,
} from "../../../../domain/index.ts";
import { createSessionPrompt } from "../../../../opencode/session-prompt.ts";
import { readPromptFile } from "../../../../opencode/read-prompt-file.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, type Accessor } from "solid-js";

import type { ComposerReview } from "./SessionPane/Composer.tsx";

const PROMPT_FAILURE_MESSAGE =
  "Couldn't confirm the message was sent. Your draft has been restored.";

type SessionPrompt = ReturnType<typeof createSessionPrompt>;

type SubmissionRequest = {
  readonly sessionID: string;
  readonly id: string;
  readonly prompt: SessionPrompt;
  readonly text: string;
  readonly delivery: SessionInboxDelivery;
  readonly files: readonly File[];
  readonly reviewSnapshot: ReturnType<ReviewDraftStore["capture"]> | undefined;
  readonly annotations: AnnotationDraftSnapshot;
};

type SessionComposerOptions = {
  readonly effects: WorkspaceOwner;
  readonly runtime: {
    readonly data: {
      readonly session: Pick<ConnectedRuntime["data"]["session"], "prompt"> & {
        readonly message: Pick<ConnectedRuntime["data"]["session"]["message"], "get">;
      };
    };
  };
  readonly selectedID: Accessor<string | undefined>;
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
  readonly files: Accessor<readonly File[]>;
  readonly pasteFiles: (files: readonly File[]) => void;
  readonly removeFile: (file: File) => void;
  readonly disabled: Accessor<boolean>;
  readonly submitting: Accessor<boolean>;
  readonly error: Accessor<string | undefined>;
  readonly review: Accessor<ComposerReview | undefined>;
  readonly input: (value: string) => void;
  readonly submit: (delivery?: SessionInboxDelivery) => Promise<void>;
  readonly clear: (sessionID: string) => void;
};

/** Owns session drafts and prompt admission for the selected conversation. */
export function createSessionComposer(options: SessionComposerOptions): SessionComposerController {
  const { effects } = options;
  const drafts = createSessionDraftStore(effects);
  const fileDrafts = Atom.make<Readonly<Record<string, readonly File[]>>>({});
  effects.mount(fileDrafts);
  const fileState = useAtomValue(() => fileDrafts);
  const files = () => fileState()[options.selectedID() ?? ""] ?? [];
  const setFiles = (sessionID: string, next: readonly File[]) => {
    const current = { ...effects.registry.get(fileDrafts) };
    if (next.length === 0) delete current[sessionID];
    else current[sessionID] = next;
    effects.registry.set(fileDrafts, current);
  };
  const pasteFiles = (incoming: readonly File[]) => {
    const sessionID = options.selectedID();
    if (sessionID !== undefined) setFiles(sessionID, [...files(), ...incoming]);
  };
  const removeFile = (file: File) => {
    const sessionID = options.selectedID();
    if (sessionID !== undefined)
      setFiles(
        sessionID,
        files().filter((item) => item !== file),
      );
  };
  const admission = Atom.make<{
    active: SubmissionRequest | undefined;
    error: SubmissionRequest | undefined;
    failed: Readonly<Record<string, SubmissionRequest | undefined>>;
  }>({ active: undefined, error: undefined, failed: {} });
  effects.mount(admission);
  const state = useAtomValue(() => admission);
  const activeRequest = () => effects.registry.get(admission).active;
  const setActiveRequest = (active: SubmissionRequest | undefined): void => {
    effects.registry.set(admission, { ...effects.registry.get(admission), active });
  };
  const setErrorRequest = (error: SubmissionRequest | undefined): void => {
    effects.registry.set(admission, { ...effects.registry.get(admission), error });
  };
  const failedRequest = (sessionID: string) => effects.registry.get(admission).failed[sessionID];
  const setFailedRequest = (sessionID: string, request: SubmissionRequest | undefined): void => {
    const current = effects.registry.get(admission);
    effects.registry.set(admission, {
      ...current,
      failed: { ...current.failed, [sessionID]: request },
    });
  };

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
      state().active !== undefined ||
      options.selectionSwitching(),
  );

  const submitting = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID !== undefined && state().active?.sessionID === sessionID;
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
    const attached = effects.registry.get(fileDrafts)[sessionID] ?? [];
    if (
      text.trim() === "" &&
      reviewComments.length === 0 &&
      annotationComments.length === 0 &&
      attached.length === 0
    ) {
      return undefined;
    }
    return { text, reviewSnapshot, reviewComments, annotationComments, attached };
  };

  const submit = (delivery: SessionInboxDelivery = "steer"): Promise<void> => {
    const sessionID = options.selectedID();
    if (!isSubmissionAllowed(sessionID)) return Promise.resolve();
    const captured = captureDraft(sessionID);
    if (captured === undefined) return Promise.resolve();
    const { text, reviewSnapshot, reviewComments, annotationComments, attached } = captured;

    const retry = failedRequest(sessionID);
    const candidatePrompt = createSessionPrompt({
      instruction: text,
      reviewComments,
      annotations: annotationComments,
    });
    const retrying =
      retry !== undefined &&
      retry.delivery === delivery &&
      samePrompt(candidatePrompt, retry.prompt) &&
      attached.length === retry.files.length &&
      attached.every((file, index) => file === retry.files[index]);
    if (retry !== undefined && !retrying) forgetFailedRequest(retry);
    const annotationSnapshot = options.annotations.take(sessionID);

    const request: SubmissionRequest = {
      sessionID,
      id: retrying ? retry.id : SessionMessage.ID.create(),
      prompt: retrying ? retry.prompt : candidatePrompt,
      text,
      delivery,
      files: attached,
      reviewSnapshot,
      annotations: annotationSnapshot,
    };

    setErrorRequest(undefined);
    setFailedRequest(sessionID, undefined);
    setActiveRequest(request);
    return effects.runPromise(
      Effect.forEach(request.files, readPromptFile).pipe(
        Effect.flatMap((encodedFiles) =>
          effects.request(() =>
            options.runtime.data.session.prompt({
              sessionID,
              id: request.id,
              delivery: request.delivery,
              ...request.prompt,
              files: encodedFiles.length > 0 ? encodedFiles : undefined,
            }),
          ),
        ),
        Effect.match({
          onSuccess: () => completeSubmission(request),
          onFailure: () => {
            if (activeRequest() !== request) return;
            // The SDK rolls back before rejecting. A retained row is its durable acknowledgement.
            if (matchingMessage(request)) completeSubmission(request);
            else restoreFailed(request);
          },
        }),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (activeRequest() !== request) return;
            if (matchingMessage(request)) completeSubmission(request);
            else restoreFailed(request);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (activeRequest() === request) setActiveRequest(undefined);
          }),
        ),
      ),
    );
  };

  // A durable echo may arrive after the SDK restored our draft. The row itself
  // is the authority; the failed request only supplies the exact identity and
  // payload to match. A retry is excluded while it has an active owner.
  createEffect(() => {
    const { active, failed } = state();
    for (const request of Object.values(failed)) {
      if (request === undefined || request === active || !matchingMessage(request)) continue;
      completeSubmission(request);
    }
  });

  const clear = (sessionID: string): void => {
    drafts.clear(sessionID);
    setFiles(sessionID, []);
    options.annotations.clear(sessionID);
    options.review.drafts.clearSession(sessionID);
    const failed = failedRequest(sessionID);
    if (failed !== undefined) forgetFailedRequest(failed);
    if (activeRequest()?.sessionID === sessionID) {
      setActiveRequest(undefined);
    }
  };

  return {
    value,
    files,
    pasteFiles,
    removeFile,
    disabled,
    submitting,
    error: () => (state().error === undefined ? undefined : PROMPT_FAILURE_MESSAGE),
    review,
    input,
    submit,
    clear,
  };

  function completeSubmission(request: SubmissionRequest): void {
    if (activeRequest() !== request && failedRequest(request.sessionID) !== request) {
      return;
    }
    if (failedRequest(request.sessionID) === request) {
      options.annotations.clearIfUnchanged(request.annotations);
    }
    drafts.clearIfUnchanged(request.sessionID, request.text);
    setFiles(
      request.sessionID,
      (effects.registry.get(fileDrafts)[request.sessionID] ?? []).filter(
        (file) => !request.files.includes(file),
      ),
    );
    if (request.reviewSnapshot !== undefined) {
      options.review.drafts.clearIfUnchanged(request.reviewSnapshot);
    }
    if (failedRequest(request.sessionID) === request) {
      setFailedRequest(request.sessionID, undefined);
    }
    if (effects.registry.get(admission).error === request) setErrorRequest(undefined);
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
    if (failedRequest(request.sessionID) !== request) return;
    setFailedRequest(request.sessionID, undefined);
    if (effects.registry.get(admission).error === request) setErrorRequest(undefined);
  }

  function restoreFailed(request: SubmissionRequest): void {
    options.annotations.restore(request.annotations);
    setFailedRequest(request.sessionID, request);
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
