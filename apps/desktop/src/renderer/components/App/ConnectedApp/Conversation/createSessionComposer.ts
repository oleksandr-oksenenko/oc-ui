import {
  formatBrowserAnnotations,
  type BrowserAnnotationDraft,
} from "../Browser/browser-annotations.ts";
import {
  browserAnnotationMetadata,
  type BrowserAnnotationBatch,
} from "../../../../opencode/browser-annotation-metadata.ts";
import { useAtomValue } from "@effect/atom-solid";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { SessionInboxDelivery, PromptSkillAttachment } from "@opencode/client";
import { SessionMessage } from "@opencode/schema";
import { createSessionDraftStore } from "../../../../domain/index.ts";
import type {
  AnnotationDraftSnapshot,
  AnnotationDraftStore,
  ReviewDraftKey,
  ReviewDraftStore,
} from "../../../../domain/index.ts";
import { createSessionPrompt } from "../../../../opencode/session-prompt.ts";
import { leadingCommandName, parseSessionCommand } from "../../../../opencode/session-command.ts";
import {
  submitSessionInput,
  SessionAttachmentError,
} from "../../../../opencode/submit-session-input.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  admitAttachments,
} from "../../../../opencode/attachments.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, type Accessor } from "solid-js";

import type { ComposerCatalog, ComposerReview } from "./SessionPane/Composer.tsx";

const PROMPT_FAILURE_MESSAGE =
  "Couldn't confirm the message was sent. Your draft has been restored.";
const COMMAND_FAILURE_MESSAGE =
  "Couldn't confirm the command completed. Check the conversation before retrying; your draft has been restored.";
const COMMAND_LOADING_MESSAGE = "Commands are still loading. Try again in a moment.";
const COMMAND_UNAVAILABLE_MESSAGE = "Commands couldn't be loaded. Retry from the suggestions menu.";

const commandAttachmentMessage = (name: string | undefined): string =>
  name === undefined
    ? "Couldn't read an attached file, so the command was not sent. Your draft has been restored."
    : `Couldn't read "${name}", so the command was not sent. Your draft has been restored.`;

const promptAttachmentMessage = (name: string, reusesFailedRequest: boolean): string =>
  reusesFailedRequest
    ? `Couldn't read "${name}". Remove the file or choose it again.`
    : `Couldn't read "${name}". Your message was not sent. Remove the file or choose it again.`;

const ATTACHMENT_LIMIT_LABEL = `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;

const DRAFT_ATTACHMENT_BUDGET_LABEL = `${MAX_DRAFT_ATTACHMENTS} attachments and ${MAX_DRAFT_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;

const PASTE_TOO_LARGE_MESSAGE = `The pasted text is larger than the ${ATTACHMENT_LIMIT_LABEL} attachment limit.`;

const PASTE_BUDGET_MESSAGE = `The pasted text was not attached: the draft can hold ${DRAFT_ATTACHMENT_BUDGET_LABEL} in total. Remove an attachment and paste it again.`;

const attachmentSizeMessage = (rejected: readonly File[]): string => {
  const first = rejected[0];
  if (rejected.length === 1 && first !== undefined) {
    return `"${first.name || "An unnamed file"}" is larger than the ${ATTACHMENT_LIMIT_LABEL} attachment limit.`;
  }
  return `${rejected.length} files are larger than the ${ATTACHMENT_LIMIT_LABEL} attachment limit.`;
};

const attachmentBudgetMessage = (rejected: number): string =>
  rejected === 1
    ? `One file was not attached: the draft can hold ${DRAFT_ATTACHMENT_BUDGET_LABEL} in total. Remove an attachment before adding more.`
    : `${rejected} files were not attached: the draft can hold ${DRAFT_ATTACHMENT_BUDGET_LABEL} in total. Remove an attachment before adding more.`;

type SessionPrompt = ReturnType<typeof createSessionPrompt>;

type SubmissionBase = {
  readonly sessionID: string;
  readonly text: string;
  readonly skills: readonly PromptSkillAttachment[];
  readonly delivery: SessionInboxDelivery;
  readonly files: readonly File[];
};

type PromptSubmission = SubmissionBase & {
  readonly kind: "prompt";
  readonly id: string;
  readonly prompt: SessionPrompt;
  readonly reviewSnapshot: ReturnType<ReviewDraftStore["capture"]> | undefined;
  readonly annotations: AnnotationDraftSnapshot;
  /**
   * This attempt reuses a previously failed request ID, which may already be in
   * flight on the server, so a local read failure must not assert "not sent".
   */
  readonly reusesFailedRequest: boolean;
};

type CommandSubmission = SubmissionBase & {
  readonly kind: "command";
  readonly name: string;
  readonly arguments: string;
};

type SubmissionRequest = PromptSubmission | CommandSubmission;

type CommandNotice = {
  readonly sessionID: string;
  readonly kind: "blocked" | "attachment" | "dispatch";
  readonly name?: string;
};

type AttachmentNotice = {
  readonly sessionID: string;
  readonly message: string;
  /** Set when the notice describes a submission attempt, so its echo can clear it. */
  readonly request?: PromptSubmission | undefined;
};

type AdmissionState = {
  active: Readonly<Record<string, SubmissionRequest | undefined>>;
  error: PromptSubmission | undefined;
  commandNotice: CommandNotice | undefined;
  attachmentNotice: AttachmentNotice | undefined;
  failed: Readonly<Record<string, PromptSubmission | undefined>>;
};

type SessionComposerOptions = {
  readonly effects: WorkspaceOwner;
  readonly runtime: {
    readonly api: {
      readonly session: Pick<ConnectedRuntime["api"]["session"], "command">;
    };
    readonly data: {
      readonly session: Pick<ConnectedRuntime["data"]["session"], "prompt"> & {
        readonly message: Pick<ConnectedRuntime["data"]["session"]["message"], "get">;
      };
    };
  };
  readonly commands: Accessor<ComposerCatalog["commands"]>;
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
  readonly skills: Accessor<readonly PromptSkillAttachment[]>;
  readonly files: Accessor<readonly File[]>;
  readonly attachFiles: (files: readonly File[]) => void;
  /**
   * Attaches pasted text. Text over the byte cap or past the draft's aggregate
   * attachment budget is refused with a notice; nothing is retained.
   */
  readonly attachText: (text: string) => void;
  readonly removeFile: (file: File) => void;
  readonly browserBatches: Accessor<readonly BrowserAnnotationBatch[]>;
  readonly removeBrowserBatch: (batch: BrowserAnnotationBatch) => void;
  /** Attach structured annotations and their screenshots together, or make no change. */
  readonly appendBatch: (
    sessionID: string,
    files: readonly File[],
    annotations: readonly BrowserAnnotationDraft[],
  ) => void;
  readonly disabled: Accessor<boolean>;
  readonly submitting: Accessor<boolean>;
  readonly error: Accessor<string | undefined>;
  readonly review: Accessor<ComposerReview | undefined>;
  /** The recognized command invocation for the current draft, if any. */
  readonly command: Accessor<string | undefined>;
  readonly input: (value: string, skills?: readonly PromptSkillAttachment[]) => void;
  readonly submit: (delivery?: SessionInboxDelivery) => Promise<void>;
  readonly clear: (sessionID: string) => void;
};

/** Owns session drafts, command recognition, and prompt admission for the selected conversation. */
export function createSessionComposer(options: SessionComposerOptions): SessionComposerController {
  const { effects } = options;
  const drafts = createSessionDraftStore(effects);
  // Metadata belongs to the admitted screenshot objects, not their filenames.
  const browserBatches = Atom.make<Readonly<Record<string, readonly BrowserAnnotationBatch[]>>>({});
  effects.mount(browserBatches);
  const batchState = useAtomValue(() => browserBatches);
  const selectedBatches = () => batchState()[options.selectedID() ?? ""] ?? [];
  const fileDrafts = Atom.make<Readonly<Record<string, readonly File[]>>>({});
  effects.mount(fileDrafts);
  const fileState = useAtomValue(() => fileDrafts);
  const files = () => fileState()[options.selectedID() ?? ""] ?? [];
  const setFiles = (sessionID: string, next: readonly File[]) => {
    const current = { ...effects.registry.get(fileDrafts) };
    if (next.length === 0) delete current[sessionID];
    else current[sessionID] = next;
    effects.registry.set(fileDrafts, current);
    const batches = { ...effects.registry.get(browserBatches) };
    const retained = (batches[sessionID] ?? []).flatMap((batch) => {
      if (batch.files.every((file) => next.includes(file))) return [batch];
      const retainedFiles = batch.files.filter((file) => next.includes(file));
      if (retainedFiles.length === 0) return [];
      return [
        {
          files: retainedFiles,
          annotations: batch.annotations
            .filter((item) => next.includes(batch.files[item.fileIndex]!))
            .map((item) => ({
              ...item,
              fileIndex: retainedFiles.indexOf(batch.files[item.fileIndex]!),
            })),
        },
      ];
    });
    if (retained.length === 0) delete batches[sessionID];
    else batches[sessionID] = retained;
    effects.registry.set(browserBatches, batches);
  };
  const attachFiles = (incoming: readonly File[]) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return;
    const existing = files();
    const { admitted, tooLarge, overBudget } = admitAttachments(existing, incoming);
    if (admitted.length > 0) setFiles(sessionID, [...existing, ...admitted]);
    // New selection feedback replaces any earlier attachment or command-read error.
    clearCommandAttachmentNotice(sessionID);
    const notices: string[] = [];
    if (tooLarge.length > 0) notices.push(attachmentSizeMessage(tooLarge));
    if (overBudget.length > 0) notices.push(attachmentBudgetMessage(overBudget.length));
    if (notices.length > 0) setAttachmentNotice(sessionID, notices.join(" "));
    else if (admitted.length > 0) clearAttachmentNotice(sessionID);
  };
  /**
   * The clipboard intent for text too large to edit inline. Clipboard strings
   * carry no size metadata, so the UTF-16 length is checked first (a lower
   * bound on UTF-8 bytes) and the encoded `File.size` is the exact cap; the
   * text is never encoded twice. A refusal names the reason and keeps the
   * draft unchanged; nothing is retained.
   */
  const attachText = (text: string) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined || text.trim() === "") return;
    if (text.length > MAX_ATTACHMENT_BYTES) {
      setAttachmentNotice(sessionID, PASTE_TOO_LARGE_MESSAGE);
      return;
    }
    const existing = files();
    const file = new File([text], pastedTextName(existing), { type: "text/plain" });
    const { admitted, tooLarge } = admitAttachments(existing, [file]);
    if (admitted.length === 0) {
      setAttachmentNotice(
        sessionID,
        tooLarge.length > 0 ? PASTE_TOO_LARGE_MESSAGE : PASTE_BUDGET_MESSAGE,
      );
      return;
    }
    setFiles(sessionID, [...existing, ...admitted]);
    clearCommandAttachmentNotice(sessionID);
    clearAttachmentNotice(sessionID);
  };
  const removeFile = (file: File) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return;
    setFiles(
      sessionID,
      files().filter((item) => item !== file),
    );
    clearCommandAttachmentNotice(sessionID);
    clearAttachmentNotice(sessionID);
  };
  const appendBatch = (
    sessionID: string,
    incoming: readonly File[],
    annotations: readonly BrowserAnnotationDraft[],
  ) => {
    if (!sessionID) throw new Error("Annotations need a target conversation.");
    if (annotations.length === 0 || annotations.some((item) => !item.body.trim()))
      throw new Error("Annotations need at least one comment.");
    if (incoming.length === 0) throw new Error("Annotations need at least one screenshot.");
    if (annotations.length !== incoming.length)
      throw new Error("Every annotation needs a screenshot.");
    const existing = effects.registry.get(fileDrafts)[sessionID] ?? [];
    const { admitted, tooLarge, overBudget } = admitAttachments(existing, incoming);
    if (tooLarge.length > 0) throw new Error(attachmentSizeMessage(tooLarge));
    if (overBudget.length > 0) throw new Error(attachmentBudgetMessage(overBudget.length));
    if (admitted.length !== incoming.length)
      throw new Error("Every annotation needs its own new screenshot.");
    const batch: BrowserAnnotationBatch = {
      files: admitted,
      annotations: annotations.map((item, fileIndex) => ({
        number: item.number,
        mode: item.mode,
        body: item.body,
        url: item.tab.url,
        title: item.tab.title,
        capturedAt: item.capturedAt,
        selection: { ...item.selection, bounds: { ...item.selection.bounds } },
        fileIndex,
      })),
    };
    setFiles(sessionID, [...existing, ...admitted]);
    const batches = effects.registry.get(browserBatches);
    effects.registry.set(browserBatches, {
      ...batches,
      [sessionID]: [...(batches[sessionID] ?? []), batch],
    });
  };
  const removeBrowserBatch = (batch: BrowserAnnotationBatch) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined || !selectedBatches().includes(batch)) return;
    setFiles(
      sessionID,
      files().filter((file) => !batch.files.includes(file)),
    );
    clearCommandAttachmentNotice(sessionID);
    clearAttachmentNotice(sessionID);
  };
  const browserContext = (sessionID: string) =>
    (effects.registry.get(browserBatches)[sessionID] ?? [])
      .map((batch) =>
        formatBrowserAnnotations(
          batch.annotations.map((item) => ({
            ...item,
            tab: { url: item.url, title: item.title },
            image: { name: batch.files[item.fileIndex]!.name },
          })),
        ),
      )
      .join("\n\n");
  const withBrowserContext = (sessionID: string, text: string) => {
    const context = browserContext(sessionID);
    return context ? (text ? `${text.trimEnd()}\n\n${context}` : context) : text;
  };
  const admission = Atom.make<AdmissionState>({
    active: {},
    error: undefined,
    commandNotice: undefined,
    attachmentNotice: undefined,
    failed: {},
  });
  effects.mount(admission);
  const state = useAtomValue(() => admission);
  const activeRequest = (sessionID = options.selectedID() ?? "") =>
    effects.registry.get(admission).active[sessionID];
  const setActiveRequest = (
    active: SubmissionRequest | undefined,
    sessionID = active?.sessionID ?? options.selectedID() ?? "",
  ): void => {
    const current = effects.registry.get(admission);
    effects.registry.set(admission, {
      ...current,
      active: { ...current.active, [sessionID]: active },
    });
  };
  const setErrorRequest = (error: PromptSubmission | undefined): void => {
    effects.registry.set(admission, { ...effects.registry.get(admission), error });
  };
  const failedRequest = (sessionID: string) => effects.registry.get(admission).failed[sessionID];
  const setFailedRequest = (sessionID: string, request: PromptSubmission | undefined): void => {
    const current = effects.registry.get(admission);
    effects.registry.set(admission, {
      ...current,
      failed: { ...current.failed, [sessionID]: request },
    });
  };
  const setCommandNotice = (
    sessionID: string,
    kind: "blocked" | "attachment" | "dispatch" | undefined,
    name?: string,
  ): void => {
    effects.registry.set(admission, {
      ...effects.registry.get(admission),
      commandNotice: kind === undefined ? undefined : { sessionID, kind, name },
    });
  };
  const setAttachmentNotice = (
    sessionID: string,
    message: string,
    request?: PromptSubmission,
  ): void => {
    effects.registry.set(admission, {
      ...effects.registry.get(admission),
      attachmentNotice: { sessionID, message, request },
    });
  };
  const clearAttachmentNoticeForRequest = (request: PromptSubmission): void => {
    const notice = effects.registry.get(admission).attachmentNotice;
    if (notice?.request !== request) return;
    effects.registry.set(admission, {
      ...effects.registry.get(admission),
      attachmentNotice: undefined,
    });
  };
  const clearAttachmentNotice = (sessionID: string): void => {
    const notice = effects.registry.get(admission).attachmentNotice;
    if (notice === undefined || notice.sessionID !== sessionID) return;
    effects.registry.set(admission, {
      ...effects.registry.get(admission),
      attachmentNotice: undefined,
    });
  };
  const clearCommandAttachmentNotice = (sessionID: string): void => {
    const notice = effects.registry.get(admission).commandNotice;
    if (notice?.kind !== "attachment" || notice.sessionID !== sessionID) return;
    setCommandNotice(sessionID, undefined);
  };

  createEffect(() => {
    options.selectedID();
    setErrorRequest(undefined);
    setCommandNotice(options.selectedID() ?? "", undefined);
  });

  // A blocked notice only describes an unavailable inventory.
  createEffect(() => {
    if (options.commands().state !== "ready") return;
    const notice = state().commandNotice;
    if (notice?.kind === "blocked" && notice.sessionID === options.selectedID()) {
      setCommandNotice(notice.sessionID, undefined);
    }
  });

  // A blocked notice stops applying when the draft is no longer a command.
  createEffect(() => {
    const notice = state().commandNotice;
    if (notice?.kind !== "blocked" || notice.sessionID !== options.selectedID()) return;
    if (leadingCommandName(drafts.get(notice.sessionID)) === undefined) {
      setCommandNotice(notice.sessionID, undefined);
    }
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
      state().active[options.selectedID() ?? ""] !== undefined ||
      options.selectionSwitching(),
  );

  const submitting = createMemo(() => {
    const sessionID = options.selectedID();
    return sessionID !== undefined && state().active[sessionID] !== undefined;
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
    return { comments, onDiscard: discard };
  });

  const command = createMemo(() => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return undefined;
    const entries = options.commands();
    if (entries.state !== "ready") return undefined;
    return parseSessionCommand(
      drafts.get(sessionID),
      entries.items.map((item) => item.name),
    )?.name;
  });

  const input = (nextValue: string, skills: readonly PromptSkillAttachment[] = []): void => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return;
    drafts.set(sessionID, nextValue, skills);
  };

  const isSubmissionAllowed = (sessionID: string | undefined): sessionID is string =>
    sessionID !== undefined && !disabled();

  const submit = (delivery: SessionInboxDelivery = "steer"): Promise<void> => {
    const sessionID = options.selectedID();
    if (!isSubmissionAllowed(sessionID)) return Promise.resolve();
    const text = drafts.get(sessionID);
    const skills = drafts.skills(sessionID);
    const attached = effects.registry.get(fileDrafts)[sessionID] ?? [];
    const name = leadingCommandName(text);
    const inventory = options.commands();

    // A leading slash with an unloaded inventory cannot be classified. Sending
    // it as prompt text would silently consume attachments the command path
    // exists to preserve, so the caller gets an explicit notice instead.
    if (name !== undefined && inventory.state !== "ready") {
      // The blocked submission is the newest visible failure; keep any failed
      // prompt record so its durable echo can still reconcile.
      setErrorRequest(undefined);
      clearAttachmentNotice(sessionID);
      setCommandNotice(sessionID, "blocked");
      return Promise.resolve();
    }

    if (name !== undefined) {
      const invocation = parseSessionCommand(
        text,
        inventory.items.map((item) => item.name),
      );
      if (invocation !== undefined) {
        return submitCommand(sessionID, invocation, text, skills, attached, delivery);
      }
    }

    return submitPrompt(sessionID, text, skills, attached, delivery);
  };

  const submitCommand = (
    sessionID: string,
    invocation: { readonly name: string; readonly arguments: string },
    text: string,
    skills: readonly PromptSkillAttachment[],
    attached: readonly File[],
    delivery: SessionInboxDelivery,
  ): Promise<void> => {
    const failed = failedRequest(sessionID);
    if (failed !== undefined) forgetFailedRequest(failed);
    const request: CommandSubmission = {
      kind: "command",
      sessionID,
      name: invocation.name,
      arguments: withBrowserContext(sessionID, invocation.arguments),
      text,
      skills,
      delivery,
      files: attached,
    };
    setCommandNotice(sessionID, undefined);
    clearAttachmentNotice(sessionID);
    setErrorRequest(undefined);
    setActiveRequest(request);
    return admit(request, submitSessionInput(effects, options.runtime, request));
  };

  const submitPrompt = (
    sessionID: string,
    text: string,
    skills: readonly PromptSkillAttachment[],
    attached: readonly File[],
    delivery: SessionInboxDelivery,
  ): Promise<void> => {
    const key = activeReviewKey();
    const reviewCapture = key === undefined ? undefined : options.review.drafts.capture(key);
    const reviewComments = reviewCapture?.comments ?? [];
    const reviewSnapshot = reviewComments.length > 0 ? reviewCapture : undefined;
    const annotationComments = options.annotations
      .get(sessionID)
      .filter((comment) => comment.body.trim() !== "");
    if (
      text.trim() === "" &&
      reviewComments.length === 0 &&
      annotationComments.length === 0 &&
      attached.length === 0
    ) {
      return Promise.resolve();
    }

    const retry = failedRequest(sessionID);
    const basePrompt = createSessionPrompt({
      instruction: withBrowserContext(sessionID, text),
      reviewComments,
      annotations: annotationComments,
      skills,
    });
    const browserMetadata = browserAnnotationMetadata(
      reviewComments.length + annotationComments.length > 0 ? text.trim() : text,
      (effects.registry.get(browserBatches)[sessionID] ?? []).flatMap((batch) =>
        batch.annotations.map((item) => ({
          ...item,
          fileIndex: attached.indexOf(batch.files[item.fileIndex]!),
        })),
      ),
    );
    const candidatePrompt =
      browserMetadata === undefined
        ? basePrompt
        : {
            ...basePrompt,
            metadata: { ...basePrompt.metadata, ...browserMetadata },
          };
    const retrying =
      retry !== undefined &&
      retry.delivery === delivery &&
      samePrompt(candidatePrompt, retry.prompt) &&
      attached.length === retry.files.length &&
      attached.every((file, index) => file === retry.files[index]);
    if (retry !== undefined && !retrying) forgetFailedRequest(retry);
    const annotationSnapshot = options.annotations.take(sessionID);

    const request: PromptSubmission = {
      kind: "prompt",
      sessionID,
      id: retrying ? retry.id : SessionMessage.ID.create(),
      prompt: retrying ? retry.prompt : candidatePrompt,
      text,
      skills,
      delivery,
      files: attached,
      reviewSnapshot,
      annotations: annotationSnapshot,
      reusesFailedRequest: retrying,
    };

    setCommandNotice(sessionID, undefined);
    clearAttachmentNotice(sessionID);
    setErrorRequest(undefined);
    setFailedRequest(sessionID, undefined);
    setActiveRequest(request);
    return admit(request, submitSessionInput(effects, options.runtime, request));
  };

  const admit = <A, E>(request: SubmissionRequest, work: Effect.Effect<A, E>) =>
    effects.runPromise(
      work.pipe(
        Effect.match({
          onSuccess: () => completeSubmission(request),
          onFailure: (cause) => failSubmission(request, cause),
        }),
        Effect.onInterrupt(() => Effect.sync(() => failSubmission(request))),
        Effect.ensuring(
          Effect.sync(() => {
            if (activeRequest(request.sessionID) === request)
              setActiveRequest(undefined, request.sessionID);
          }),
        ),
      ),
    );

  // A durable echo may arrive after the SDK restored our draft. The row itself
  // is the authority; the failed request only supplies the exact identity and
  // payload to match. A retry is excluded while it has an active owner.
  createEffect(() => {
    const { active, failed } = state();
    for (const request of Object.values(failed)) {
      if (
        request === undefined ||
        request === active[request.sessionID] ||
        !matchingMessage(request)
      )
        continue;
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
    if (activeRequest(sessionID)) {
      setActiveRequest(undefined, sessionID);
    }
    if (effects.registry.get(admission).commandNotice?.sessionID === sessionID) {
      setCommandNotice(sessionID, undefined);
    }
    clearAttachmentNotice(sessionID);
  };

  return {
    value,
    skills: () => drafts.skills(options.selectedID() ?? ""),
    files,
    attachFiles,
    attachText,
    removeFile,
    browserBatches: selectedBatches,
    removeBrowserBatch,
    appendBatch,
    disabled,
    submitting,
    error: () => {
      const notice = state().commandNotice;
      if (notice !== undefined && notice.sessionID === options.selectedID()) {
        if (notice.kind === "blocked") {
          if (options.commands().state === "ready") return undefined;
          return options.commands().state === "loading"
            ? COMMAND_LOADING_MESSAGE
            : COMMAND_UNAVAILABLE_MESSAGE;
        }
        return notice.kind === "attachment"
          ? commandAttachmentMessage(notice.name)
          : COMMAND_FAILURE_MESSAGE;
      }
      const attachment = state().attachmentNotice;
      const attachmentMessage =
        attachment !== undefined && attachment.sessionID === options.selectedID()
          ? attachment.message
          : undefined;
      const failure = state().error === undefined ? undefined : PROMPT_FAILURE_MESSAGE;
      // A draft size rejection raised while a send was pending and the send's own
      // failure are both keepers; show them together rather than hiding either.
      if (attachmentMessage !== undefined && failure !== undefined) {
        return `${attachmentMessage} ${failure}`;
      }
      return attachmentMessage ?? failure;
    },
    review,
    command,
    input,
    submit,
    clear,
  };

  function completeSubmission(request: SubmissionRequest): void {
    if (
      activeRequest(request.sessionID) !== request &&
      (request.kind === "command" || failedRequest(request.sessionID) !== request)
    ) {
      return;
    }
    if (request.kind === "prompt") {
      // A confirmed echo resolves this attempt's own read-failure notice; an
      // unrelated newer size notice is preserved.
      clearAttachmentNoticeForRequest(request);
    }
    if (request.kind === "prompt" && failedRequest(request.sessionID) === request) {
      options.annotations.clearIfUnchanged(request.annotations);
    }
    drafts.clearIfUnchanged(request.sessionID, request.text, request.skills);
    setFiles(
      request.sessionID,
      (effects.registry.get(fileDrafts)[request.sessionID] ?? []).filter(
        (file) => !request.files.includes(file),
      ),
    );
    if (request.kind === "prompt" && request.reviewSnapshot !== undefined) {
      options.review.drafts.clearIfUnchanged(request.reviewSnapshot);
    }
    if (request.kind === "prompt" && failedRequest(request.sessionID) === request) {
      setFailedRequest(request.sessionID, undefined);
    }
    if (request.kind === "prompt" && effects.registry.get(admission).error === request) {
      setErrorRequest(undefined);
    }
    if (
      request.kind === "command" &&
      effects.registry.get(admission).commandNotice?.sessionID === request.sessionID
    ) {
      setCommandNotice(request.sessionID, undefined);
    }
    if (activeRequest(request.sessionID) === request) {
      setActiveRequest(undefined, request.sessionID);
    }
  }

  function failSubmission(request: SubmissionRequest, cause?: unknown): void {
    if (activeRequest(request.sessionID) !== request) return;
    if (request.kind === "prompt" && matchingMessage(request)) {
      completeSubmission(request);
      return;
    }
    if (request.kind === "prompt") {
      if (Schema.is(SessionAttachmentError)(cause)) {
        restoreAttachmentFailure(request, cause.name);
        return;
      }
      restoreFailed(request);
      return;
    }
    if (options.selectedID() === request.sessionID) {
      setErrorRequest(undefined);
      if (Schema.is(SessionAttachmentError)(cause)) {
        setCommandNotice(request.sessionID, "attachment", cause.name);
      } else {
        setCommandNotice(request.sessionID, "dispatch");
      }
    }
    setActiveRequest(undefined, request.sessionID);
  }

  function matchingMessage(request: PromptSubmission): boolean {
    const message = options.runtime.data.session.message.get(request.sessionID, request.id);
    return (
      message?.type === "user" &&
      message.text === request.prompt.text &&
      sameValue(message.metadata, request.prompt.metadata) &&
      sameValue(
        (message.skills ?? []).map(({ id, mention }) => ({ id, mention })),
        (request.prompt.skills ?? []).map(({ id, mention }) => ({ id, mention })),
      )
    );
  }

  function forgetFailedRequest(request: PromptSubmission): void {
    if (failedRequest(request.sessionID) !== request) return;
    setFailedRequest(request.sessionID, undefined);
    if (effects.registry.get(admission).error === request) setErrorRequest(undefined);
  }

  function restoreFailed(request: PromptSubmission): void {
    options.annotations.restore(request.annotations);
    setFailedRequest(request.sessionID, request);
    if (options.selectedID() === request.sessionID) setErrorRequest(request);
    setActiveRequest(undefined, request.sessionID);
  }

  function restoreAttachmentFailure(request: PromptSubmission, name: string): void {
    // Nothing from this attempt reached the server, but a reused request ID may
    // already be in flight, so the wording must not assert it was never sent.
    options.annotations.restore(request.annotations);
    setFailedRequest(request.sessionID, request);
    if (options.selectedID() === request.sessionID) {
      setAttachmentNotice(
        request.sessionID,
        promptAttachmentMessage(name, request.reusesFailedRequest),
        request,
      );
    }
    setActiveRequest(undefined, request.sessionID);
  }
}

function samePrompt(left: SessionPrompt, right: SessionPrompt): boolean {
  return (
    left.text === right.text &&
    sameValue(left.metadata, right.metadata) &&
    sameValue(left.skills, right.skills)
  );
}

/** A free file name for a pasted-text attachment within one session's draft. */
function pastedTextName(existing: readonly File[]): string {
  const used = new Set(existing.map((file) => file.name));
  let index = 1;
  let name = "pasted-text.txt";
  while (used.has(name)) {
    index += 1;
    name = `pasted-text-${index}.txt`;
  }
  return name;
}

function sameValue<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
