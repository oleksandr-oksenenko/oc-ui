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
import { readPromptFile } from "../../../../opencode/read-prompt-file.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  MAX_RETAINED_PASTE_UNITS,
  MAX_TEXT_ATTACHMENT_BYTES,
  selectAttachableFiles,
} from "../../../../opencode/attachments.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { createEffect, createMemo, type Accessor } from "solid-js";

import type {
  ComposerCatalog,
  ComposerPasteRecovery,
  ComposerReview,
} from "./SessionPane/Composer.tsx";

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

const TEXT_ATTACHMENT_LIMIT_LABEL = `${MAX_TEXT_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;

const DRAFT_ATTACHMENT_BUDGET_LABEL = `${MAX_DRAFT_ATTACHMENTS} attachments and ${MAX_DRAFT_ATTACHMENT_BYTES / (1024 * 1024)} MiB`;

const PASTE_TOO_LARGE_MESSAGE = `The pasted text is larger than the ${TEXT_ATTACHMENT_LIMIT_LABEL} attachment limit, so it was not attached. Restore it as text instead.`;

const PASTE_TOO_LARGE_TO_RETAIN_MESSAGE = `The pasted text is larger than the ${TEXT_ATTACHMENT_LIMIT_LABEL} attachment limit and too large to keep for restore. Copy a smaller part instead.`;

const PASTE_BUDGET_MESSAGE = `The pasted text was not attached: the draft can hold ${DRAFT_ATTACHMENT_BUDGET_LABEL} in total. Restore it as text, or remove an attachment and paste it again.`;

const PASTE_RECOVERY_PENDING_MESSAGE =
  "A previous paste is still waiting to be restored or dismissed. Choose Restore text or Dismiss before pasting again.";

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

class CommandAttachmentError extends Schema.TaggedError<CommandAttachmentError>()(
  "CommandAttachmentError",
  { name: Schema.String },
) {}

class PromptAttachmentError extends Schema.TaggedError<PromptAttachmentError>()(
  "PromptAttachmentError",
  { name: Schema.String },
) {}

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
  active: SubmissionRequest | undefined;
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
   * attachment budget is retained for recovery instead of attached; text past
   * the recovery bound is refused with a notice.
   */
  readonly attachText: (text: string) => void;
  readonly removeFile: (file: File) => void;
  /** Append annotation text and its screenshots together, or make no change. */
  readonly appendBatch: (sessionID: string, text: string, files: readonly File[]) => void;
  /** The retained source text of a rejected paste for the selected session. */
  readonly pasteRecovery: Accessor<ComposerPasteRecovery | undefined>;
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
  /**
   * Source text retained when a paste could not become an attachment, with the
   * message that explains its rejection. It is keyed by the session that
   * initiated the paste, so a navigation never moves it and the recovery
   * surface always belongs to its origin session.
   */
  const pasteRecoveries = Atom.make<
    Readonly<Record<string, { readonly text: string; readonly message: string } | undefined>>
  >({});
  effects.mount(pasteRecoveries);
  const recoveryState = useAtomValue(() => pasteRecoveries);
  const setRecovery = (
    sessionID: string,
    entry: { readonly text: string; readonly message: string } | undefined,
  ) => {
    const current = { ...effects.registry.get(pasteRecoveries) };
    if (entry === undefined) delete current[sessionID];
    else current[sessionID] = entry;
    effects.registry.set(pasteRecoveries, current);
  };
  const attachFiles = (incoming: readonly File[]) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return;
    const { accepted, rejected } = selectAttachableFiles(incoming);
    // A draft owns each File object once; removal and completion track identity.
    const known = new Set(files());
    const next: File[] = [];
    let budget = remainingAttachmentBudget(files());
    let excess = 0;
    for (const file of accepted) {
      if (known.has(file)) continue;
      if (budget.count <= 0 || file.size > budget.bytes) {
        excess += 1;
        continue;
      }
      known.add(file);
      next.push(file);
      budget = { count: budget.count - 1, bytes: budget.bytes - file.size };
    }
    if (next.length > 0) setFiles(sessionID, [...files(), ...next]);
    // New selection feedback replaces any earlier attachment or command-read error.
    clearCommandAttachmentNotice(sessionID);
    const notices: string[] = [];
    if (rejected.length > 0) notices.push(attachmentSizeMessage(rejected));
    if (excess > 0) notices.push(attachmentBudgetMessage(excess));
    if (notices.length > 0) setAttachmentNotice(sessionID, notices.join(" "));
    else if (next.length > 0) clearAttachmentNotice(sessionID);
  };
  /**
   * The clipboard intent for text too large to edit inline. Clipboard strings
   * carry no size metadata, so the UTF-16 length is checked first (a lower
   * bound on UTF-8 bytes) and the encoded `File.size` is the exact cap; the
   * text is never encoded twice. A rejection retains the source text through
   * the recovery surface and never attaches to whatever session becomes active
   * later. An attachable paste still needs room in the draft's aggregate
   * budget; a paste that does not fit is retained the same way rather than
   * partially attached or dropped.
   */
  const attachText = (text: string) => {
    const sessionID = options.selectedID();
    if (sessionID === undefined || text.trim() === "") return;
    // A rejected paste keeps its source until the user resolves it. Refusing
    // the new text instead of replacing or clearing the recovery keeps that
    // promise and names the action that releases it.
    if (effects.registry.get(pasteRecoveries)[sessionID] !== undefined) {
      setAttachmentNotice(sessionID, PASTE_RECOVERY_PENDING_MESSAGE);
      return;
    }
    if (text.length > MAX_TEXT_ATTACHMENT_BYTES) {
      retainRejected(sessionID, text, PASTE_TOO_LARGE_MESSAGE);
      return;
    }
    const existing = effects.registry.get(fileDrafts)[sessionID] ?? [];
    const file = new File([text], pastedTextName(existing), { type: "text/plain" });
    if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      retainRejected(sessionID, text, PASTE_TOO_LARGE_MESSAGE);
      return;
    }
    const budget = remainingAttachmentBudget(existing);
    if (budget.count <= 0 || file.size > budget.bytes) {
      // The source is under the retention bound whenever it is under the text
      // cap, so a budget rejection is always recoverable.
      retainRejected(sessionID, text, PASTE_BUDGET_MESSAGE);
      return;
    }
    setFiles(sessionID, [...existing, file]);
    clearCommandAttachmentNotice(sessionID);
    clearAttachmentNotice(sessionID);
  };
  /**
   * Retains a rejected paste's source within {@link MAX_RETAINED_PASTE_UNITS},
   * with the message that explains its rejection. Past the bound nothing is
   * kept, so an arbitrarily large clipboard string cannot pin the renderer's
   * memory; the notice names the reason.
   */
  const retainRejected = (sessionID: string, text: string, message: string): void => {
    if (text.length > MAX_RETAINED_PASTE_UNITS) {
      setAttachmentNotice(sessionID, PASTE_TOO_LARGE_TO_RETAIN_MESSAGE);
      return;
    }
    setRecovery(sessionID, { text, message });
  };
  const pasteRecovery = createMemo<ComposerPasteRecovery | undefined>(() => {
    const sessionID = options.selectedID();
    if (sessionID === undefined) return undefined;
    const entry = recoveryState()[sessionID];
    if (entry === undefined) return undefined;
    return {
      message: entry.message,
      // Both actions stay bound to the origin session captured here.
      take: () => {
        const current = effects.registry.get(pasteRecoveries)[sessionID];
        if (current === undefined) return undefined;
        setRecovery(sessionID, undefined);
        clearRecoveryNotice(sessionID);
        return current.text;
      },
      dismiss: () => {
        setRecovery(sessionID, undefined);
        clearRecoveryNotice(sessionID);
      },
    };
  });
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
  const appendBatch = (sessionID: string, text: string, incoming: readonly File[]) => {
    const body = text.trim();
    if (!sessionID) throw new Error("Annotations need a target conversation.");
    if (!body) throw new Error("Annotations need at least one comment.");
    if (incoming.length === 0) throw new Error("Annotations need at least one screenshot.");
    const oversized = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) throw new Error(`"${oversized.name}" is larger than the attachment limit.`);
    const current = drafts.get(sessionID);
    drafts.set(
      sessionID,
      current ? `${current.trimEnd()}\n\n${body}` : body,
      drafts.skills(sessionID),
    );
    const existing = effects.registry.get(fileDrafts)[sessionID] ?? [];
    setFiles(sessionID, [...existing, ...incoming]);
  };
  const admission = Atom.make<AdmissionState>({
    active: undefined,
    error: undefined,
    commandNotice: undefined,
    attachmentNotice: undefined,
    failed: {},
  });
  effects.mount(admission);
  const state = useAtomValue(() => admission);
  const activeRequest = () => effects.registry.get(admission).active;
  const setActiveRequest = (active: SubmissionRequest | undefined): void => {
    effects.registry.set(admission, { ...effects.registry.get(admission), active });
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
  /** Resolving a recovery also releases the notice that asked for it. */
  const clearRecoveryNotice = (sessionID: string): void => {
    const notice = effects.registry.get(admission).attachmentNotice;
    if (notice?.message !== PASTE_RECOVERY_PENDING_MESSAGE || notice.sessionID !== sessionID) {
      return;
    }
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
      arguments: invocation.arguments,
      text,
      skills,
      delivery,
      files: attached,
    };
    setCommandNotice(sessionID, undefined);
    clearAttachmentNotice(sessionID);
    setErrorRequest(undefined);
    setActiveRequest(request);
    return admit(request, runCommand(request));
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
    const candidatePrompt = createSessionPrompt({
      instruction: text,
      reviewComments,
      annotations: annotationComments,
      skills,
    });
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
    return admit(request, runPrompt(request));
  };

  const runPrompt = (request: PromptSubmission) =>
    Effect.forEach(request.files, readPromptFile).pipe(
      Effect.mapError((cause) => new PromptAttachmentError({ name: cause.name })),
      Effect.flatMap((encodedFiles) =>
        effects.request(() =>
          options.runtime.data.session.prompt({
            sessionID: request.sessionID,
            id: request.id,
            delivery: request.delivery,
            ...request.prompt,
            files: encodedFiles.length > 0 ? encodedFiles : undefined,
          }),
        ),
      ),
    );

  const runCommand = (request: CommandSubmission) =>
    Effect.forEach(request.files, readPromptFile).pipe(
      Effect.mapError((cause) => new CommandAttachmentError({ name: cause.name })),
      Effect.flatMap((encodedFiles) =>
        effects.request((signal) =>
          options.runtime.api.session.command(
            {
              sessionID: request.sessionID,
              command: request.name,
              text: request.arguments,
              // The server expands the template into new text, so the draft's
              // mention offsets no longer describe it.
              skills: request.skills.length ? request.skills.map(({ id }) => ({ id })) : undefined,
              delivery: request.delivery,
              files: encodedFiles.length > 0 ? encodedFiles : undefined,
            },
            { signal },
          ),
        ),
      ),
    );

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
            if (activeRequest() === request) setActiveRequest(undefined);
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
      if (request === undefined || request === active || !matchingMessage(request)) continue;
      completeSubmission(request);
    }
  });

  const clear = (sessionID: string): void => {
    drafts.clear(sessionID);
    setFiles(sessionID, []);
    setRecovery(sessionID, undefined);
    options.annotations.clear(sessionID);
    options.review.drafts.clearSession(sessionID);
    const failed = failedRequest(sessionID);
    if (failed !== undefined) forgetFailedRequest(failed);
    if (activeRequest()?.sessionID === sessionID) {
      setActiveRequest(undefined);
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
    appendBatch,
    pasteRecovery,
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
      activeRequest() !== request &&
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
    if (activeRequest() === request) {
      setActiveRequest(undefined);
    }
  }

  function failSubmission(request: SubmissionRequest, cause?: unknown): void {
    if (activeRequest() !== request) return;
    if (request.kind === "prompt" && matchingMessage(request)) {
      completeSubmission(request);
      return;
    }
    if (request.kind === "prompt") {
      if (Schema.is(PromptAttachmentError)(cause)) {
        restoreAttachmentFailure(request, cause.name);
        return;
      }
      restoreFailed(request);
      return;
    }
    if (options.selectedID() === request.sessionID) {
      setErrorRequest(undefined);
      if (Schema.is(CommandAttachmentError)(cause)) {
        setCommandNotice(request.sessionID, "attachment", cause.name);
      } else {
        setCommandNotice(request.sessionID, "dispatch");
      }
    }
    setActiveRequest(undefined);
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
    setActiveRequest(undefined);
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
    setActiveRequest(undefined);
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

/** The attachment count and bytes one session's draft may still hold. */
function remainingAttachmentBudget(files: readonly File[]) {
  const bytes = files.reduce((total, file) => total + file.size, 0);
  return {
    count: MAX_DRAFT_ATTACHMENTS - files.length,
    bytes: MAX_DRAFT_ATTACHMENT_BYTES - bytes,
  };
}

function sameValue<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
