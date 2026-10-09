import type { CommandInfo, PromptSkillAttachment, SkillInfo } from "@opencode/client";
import { PromptEditor } from "./Composer/PromptEditor.tsx";
import type { PromptEditorControl } from "./Composer/PromptEditor.tsx";
import { Icon } from "@opencode/ui/icon";
import { Button } from "@opencode/ui/button";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "../../../../../ui/Loader.tsx";
import { Tooltip } from "@opencode/ui/tooltip";
import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { collectTransferFiles, isFileTransfer } from "../../../../../opencode/attachments.ts";
import type { SentReviewComment } from "../../../../../opencode/code-review.ts";
import { isImageFile } from "../../../../../ui/ImagePreview.tsx";
import {
  AttachmentDetailPill,
  AttachmentFilePill,
  AttachmentImagePill,
  AttachmentPills,
} from "../../../../../ui/AttachmentPills.tsx";
import { ReviewAttachmentDetails } from "../../../../../ui/ReviewAttachmentDetails.tsx";
import "./Composer/Composer.css";
import { AgentPicker } from "./Composer/AgentPicker.tsx";
import { PermissionToggle, type PermissionToggleProps } from "./Composer/PermissionToggle.tsx";
import type { AgentPickerOption } from "./Composer/AgentPicker.tsx";
import { ContextMeter } from "./Composer/ContextMeter.tsx";
import type { ContextUsage } from "./Composer/context-usage.ts";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";
import { readPastedFiles, readPastedText } from "./Composer/pasteClipboard.ts";
import { classifyPaste } from "./Composer/pasteRoute.ts";
import { BrowserAttachments } from "./Composer/BrowserAttachments.tsx";
import type { BrowserAnnotationBatch } from "../../../../../opencode/browser-annotation-metadata.ts";

export type ComposerReview = {
  readonly comments: readonly SentReviewComment[];
  readonly onDiscard: (opener: HTMLButtonElement) => void;
};

type ComposerAnnotations = {
  readonly ref?: (button: HTMLButtonElement) => void;
  readonly count: number;
  readonly onOpen: (opener: HTMLButtonElement) => void;
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly onDiscard: (opener: HTMLButtonElement) => void;
};

type ComposerCatalogSection<T> = {
  readonly state: "loading" | "ready" | "failed";
  readonly items: readonly T[];
};

export type ComposerCatalog = {
  readonly commands: ComposerCatalogSection<Pick<CommandInfo, "name" | "description">>;
  readonly skills: ComposerCatalogSection<Pick<SkillInfo, "id" | "name" | "description">>;
  readonly onRetry: () => void;
};

/** The renderer marks the document with its platform before mounting (mount-app.tsx). */
const isMacPlatform = () => document.documentElement.dataset.platform === "macos";

export type ComposerProps = {
  readonly permissions?: PermissionToggleProps;
  readonly value: string;
  /** Keep submitted setup content visible without allowing edits. */
  readonly readOnly?: boolean;
  readonly sessionID?: string;
  readonly skills?: readonly PromptSkillAttachment[];
  readonly catalog?: ComposerCatalog;
  readonly files?: readonly File[];
  readonly onAttachFiles?: (files: readonly File[]) => void;
  readonly onRemoveFile?: (file: File) => void;
  readonly browserBatches?: readonly BrowserAnnotationBatch[];
  readonly onRemoveBrowserBatch?: (batch: BrowserAnnotationBatch) => void;
  /**
   * The attachment owner's clipboard intent for a text paste too large to edit
   * inline.
   */
  readonly onAttachText: (text: string) => void;
  /** Session execution and prompt admission state. */
  readonly action: "send" | "sending" | "running";
  /** Disables submission. Omit onStop when stopping is unavailable. */
  readonly disabled: boolean;
  readonly error?: string;
  /** Optional actions related to a locked draft or submission notice. */
  readonly actions?: JSX.Element;
  /** A recognized command invocation that leaves comments for the next message. */
  readonly command?: string;
  /** Omitted review state is equivalent to an empty review attachment. */
  readonly review?: ComposerReview;
  /** Omitted annotations state is equivalent to an empty annotation attachment. */
  readonly annotations?: ComposerAnnotations;
  /** Controlled attachment pills for integrations whose state is owned elsewhere. */
  readonly attachments?: { readonly count: number; readonly content: JSX.Element };
  /** Omitted context usage hides the context meter. */
  readonly contextUsage?: ContextUsage;
  readonly modelSelection: {
    readonly state: "loading" | "ready" | "failed";
    readonly switching: boolean;
    readonly disabled: boolean;
    readonly models: readonly ModelPickerOption[];
    readonly selectedModelID?: string;
    readonly variants: readonly VariantPickerOption[];
    readonly selectedVariantID?: string;
    readonly error?: string;
    readonly onSelectModel: (id: string) => void;
    readonly onSelectVariant: (id: string) => void;
    readonly onRetry?: () => void;
  };
  readonly agentSelection: {
    readonly state: "loading" | "ready" | "failed";
    readonly switching: boolean;
    readonly disabled: boolean;
    readonly agents: readonly AgentPickerOption[];
    readonly selectedAgentID?: string;
    readonly error?: string;
    readonly onSelectAgent: (id: string) => void;
    readonly onRetry?: () => void;
  };
  readonly onInput: (value: string, skills?: readonly PromptSkillAttachment[]) => void;
  readonly onSubmit: () => void;
  /** When supplied, Mod+Enter submits with queued delivery. */
  readonly onQueue?: () => void;
  readonly onStop?: () => void;
};

function selectionControls(
  props: Pick<
    ComposerProps,
    "action" | "agentSelection" | "modelSelection" | "contextUsage" | "permissions"
  >,
  attachButton: JSX.Element,
) {
  return (
    <div class="composer-picker-row">
      {attachButton}
      <PermissionToggle control={props.permissions} />
      {props.agentSelection.state === "ready" ? (
        <AgentPicker
          placeholder="Default agent"
          unavailableLabel={
            props.agentSelection.selectedAgentID === undefined ? "No agents" : "Agent unavailable"
          }
          options={props.agentSelection.agents}
          selectedID={props.agentSelection.selectedAgentID}
          disabled={
            props.agentSelection.disabled ||
            props.agentSelection.switching ||
            props.modelSelection.switching ||
            props.action === "sending"
          }
          onSelect={props.agentSelection.onSelectAgent}
        />
      ) : (
        <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
          {props.agentSelection.state === "loading" ? "Loading agents…" : "Agents unavailable"}
        </span>
      )}
      {props.modelSelection.state === "ready" ? (
        <ModelPicker
          options={props.modelSelection.models}
          selectedID={props.modelSelection.selectedModelID}
          disabled={
            props.modelSelection.disabled ||
            props.agentSelection.switching ||
            props.modelSelection.switching ||
            props.action === "sending"
          }
          onSelect={props.modelSelection.onSelectModel}
        />
      ) : (
        <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
          {props.modelSelection.state === "loading" ? "Loading models…" : "Models unavailable"}
        </span>
      )}
      <span class="composer-variant-context">
        {props.modelSelection.state === "ready" ? (
          <VariantPicker
            placeholder="Select variant"
            unavailableLabel={
              props.modelSelection.selectedModelID === undefined
                ? "Variant unavailable"
                : "No variants"
            }
            options={props.modelSelection.variants}
            selectedID={props.modelSelection.selectedVariantID}
            disabled={
              props.modelSelection.disabled ||
              props.agentSelection.switching ||
              props.modelSelection.switching ||
              props.action === "sending"
            }
            onSelect={props.modelSelection.onSelectVariant}
          />
        ) : (
          <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
            {props.modelSelection.state === "loading"
              ? "Loading variants…"
              : "Variants unavailable"}
          </span>
        )}
        <Show when={props.contextUsage}>{(usage) => <ContextMeter usage={usage()} />}</Show>
      </span>
    </div>
  );
}

function selectionStatus(
  props: Pick<ComposerProps, "action" | "agentSelection" | "error" | "modelSelection">,
) {
  const missingModel = () =>
    props.modelSelection.selectedModelID !== undefined &&
    !props.modelSelection.models.some((model) => model.id === props.modelSelection.selectedModelID);
  const emptyModels = () =>
    props.modelSelection.state === "ready" && props.modelSelection.models.length === 0;
  const selectionBusy = () =>
    props.modelSelection.switching || props.agentSelection.switching || props.action === "sending";
  return (
    <>
      {props.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.agentSelection.switching ? (
        <p class="composer-status" role="status">
          Switching agent…
        </p>
      ) : null}
      {props.modelSelection.switching ? (
        <p class="composer-status" role="status">
          Switching selection…
        </p>
      ) : null}
      {props.modelSelection.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.modelSelection.error}
        </p>
      ) : null}
      <Show when={props.modelSelection.state === "failed" && !props.modelSelection.error}>
        <p class="composer-status composer-status--error" role="alert">
          Models could not be loaded. Check the connection and try again.
        </p>
      </Show>
      <Show when={emptyModels() || (props.modelSelection.state === "ready" && missingModel())}>
        <p class="composer-status" role="status">
          {emptyModels()
            ? `${missingModel() ? "The selected model is unavailable. " : ""}No enabled models are available from this server. Configure or enable a model in OpenCode on the connected server.`
            : "The selected model is unavailable. Choose another model."}
        </p>
      </Show>
      <Show
        when={
          props.modelSelection.onRetry && (emptyModels() || props.modelSelection.state === "failed")
        }
      >
        <div class="composer-status">
          <Button
            type="button"
            size="small"
            variant="ghost-muted"
            disabled={props.modelSelection.disabled || selectionBusy()}
            onClick={props.modelSelection.onRetry}
          >
            {props.modelSelection.state === "failed" ? "Retry models" : "Refresh models"}
          </Button>
        </div>
      </Show>
      {props.agentSelection.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.agentSelection.error}
        </p>
      ) : null}
      <Show when={props.agentSelection.state === "failed" && !props.agentSelection.error}>
        <p class="composer-status composer-status--error" role="alert">
          Agents could not be loaded. Check the connection and try again.
        </p>
      </Show>
      <Show when={props.agentSelection.state === "failed" && props.agentSelection.onRetry}>
        <div class="composer-status">
          <Button
            type="button"
            size="small"
            variant="ghost-muted"
            disabled={props.agentSelection.disabled || selectionBusy()}
            onClick={props.agentSelection.onRetry}
          >
            Retry agents
          </Button>
        </div>
      </Show>
    </>
  );
}

export function Composer(props: ComposerProps) {
  let editor: HTMLDivElement | undefined;
  let form: HTMLFormElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let editorControl: PromptEditorControl | undefined;
  let pickerSessionID: string | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  let dragDepth = 0;
  /**
   * Holding a paste chord repeats the event. A repeated identical payload is
   * one intent, so the attachment path runs once per burst; the event's own
   * timestamp avoids a wall-clock global.
   */
  let lastTextAttachment: { readonly text: string; readonly at: number } | undefined;
  const isRepeatedTextAttachment = (text: string, at: number) => {
    const repeat =
      lastTextAttachment !== undefined &&
      lastTextAttachment.text === text &&
      at - lastTextAttachment.at < 400;
    lastTextAttachment = { text, at };
    return repeat;
  };
  const [dropping, setDropping] = createSignal(false);
  const canAttach = () => !props.readOnly && props.onAttachFiles !== undefined;
  const review = () => props.review;
  const attachments = () => ((props.attachments?.count ?? 0) > 0 ? props.attachments : undefined);
  const annotations = () => ((props.annotations?.count ?? 0) > 0 ? props.annotations : undefined);
  const browserBatches = () => props.browserBatches ?? [];
  const ordinaryFiles = () =>
    (props.files ?? []).filter(
      (file) => !browserBatches().some((batch) => batch.files.includes(file)),
    );
  const sendable = () =>
    review() !== undefined ||
    annotations() !== undefined ||
    attachments() !== undefined ||
    browserBatches().length > 0 ||
    props.value.trim() !== "" ||
    (props.files?.length ?? 0) > 0;

  const stopping = () => props.action === "running" && !sendable();

  const canSubmit = () =>
    !props.disabled &&
    props.action !== "sending" &&
    !props.modelSelection.switching &&
    !props.agentSelection.switching &&
    sendable();

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (!canSubmit()) return;
    props.onSubmit();
  };

  // The queue chord and its label follow the platform marker.
  const sendTooltip = () => {
    if (stopping()) return "Stop";
    if (props.onQueue) {
      const steer = props.action === "running" ? "Enter to steer" : "Enter to send";
      return `${steer} · ${isMacPlatform() ? "⌘" : "Ctrl"} Enter to queue · Shift Enter for a new line`;
    }
    return props.action === "running" ? "Send steering message (Enter)" : "Send";
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (isMacPlatform() ? event.metaKey : event.ctrlKey) {
      // The queue gesture never falls through to send, even when queueing is
      // unavailable or the draft is not eligible for submission.
      if (props.onQueue && canSubmit()) {
        props.onQueue();
      }
      return;
    }
    submit();
  };

  const attach = (incoming: readonly File[]) => {
    if (disposed || !canAttach() || incoming.length === 0) return;
    props.onAttachFiles?.(incoming);
  };

  const openPicker = () => {
    if (!canAttach()) return;
    pickerSessionID = props.sessionID;
    fileInput?.click();
  };

  const onPickerChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset so choosing the same file again re-fires the change event.
    input.value = "";
    const sessionID = pickerSessionID;
    pickerSessionID = undefined;
    // A selection made for one session must not attach to another.
    if (sessionID !== props.sessionID) return;
    attach(files);
  };

  const dragEnter = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    // Always cancel native navigation; only advertise an attachable drag.
    event.preventDefault();
    if (!canAttach()) return;
    dragDepth += 1;
    setDropping(true);
  };

  const dragOver = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = canAttach() ? "copy" : "none";
    }
  };

  const dragLeave = () => {
    if (dragDepth === 0) return;
    dragDepth -= 1;
    if (dragDepth === 0) setDropping(false);
  };

  const drop = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    setDropping(false);
    if (!canAttach()) return;
    attach(collectTransferFiles(event.dataTransfer));
  };

  /**
   * The routing owner. One capture-phase listener decides the handling for the
   * whole payload, consumes the event it owns, and never lets ProseMirror or
   * native paste process the same paste twice.
   */
  const paste = (event: ClipboardEvent) => {
    if (props.readOnly) return;
    const data = event.clipboardData;
    if (data === null) return;
    const control = editorControl;
    const files = readPastedFiles(data);
    // An IME owns the document during a composition; text paste stays with the
    // browser and the IME, exactly as ProseMirror's own handler leaves it.
    if (files.length === 0 && control?.composing() === true) return;
    const codeBlock = control?.inCodeBlock() ?? false;
    const read = readPastedText(data);
    const decision = classifyPaste({
      files,
      text: read,
      codeBlock,
    });
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (decision.route) {
      case "noop":
        consume();
        return;
      case "attachment-files":
        // Without an attachment owner the payload stays with native paste.
        if (!canAttach()) return;
        consume();
        attach(files);
        return;
      case "attachment-text":
        consume();
        if (!isRepeatedTextAttachment(read, event.timeStamp)) props.onAttachText(read);
        return;
      default: {
        if (control === undefined) return;
        consume();
        control.applyPaste({ route: decision.route, text: read });
        return;
      }
    }
  };

  onMount(() => {
    const element = form;
    if (element === undefined) return;
    // Capture phase so files and text are routed before ProseMirror handles
    // the event; Solid does not delegate drag or paste events.
    element.addEventListener("dragenter", dragEnter, true);
    element.addEventListener("dragover", dragOver, true);
    element.addEventListener("dragleave", dragLeave, true);
    element.addEventListener("drop", drop, true);
    element.addEventListener("paste", paste, true);
    onCleanup(() => {
      element.removeEventListener("dragenter", dragEnter, true);
      element.removeEventListener("dragover", dragOver, true);
      element.removeEventListener("dragleave", dragLeave, true);
      element.removeEventListener("drop", drop, true);
      element.removeEventListener("paste", paste, true);
    });
  });

  createEffect(
    on(
      () => props.sessionID,
      () => {
        // A drag or an open chooser does not survive a session change.
        dragDepth = 0;
        setDropping(false);
        pickerSessionID = undefined;
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    // Hide the drop state if attachment capability disappears mid-drag.
    if (canAttach()) return;
    dragDepth = 0;
    setDropping(false);
  });

  const attachButton = () => (
    <IconButton
      class="composer-attach"
      type="button"
      size="small"
      variant="ghost-muted"
      disabled={!canAttach()}
      aria-label="Add images and files"
      title="Add images and files"
      icon={<Icon name="plus" size="small" aria-hidden="true" />}
      onClick={openPicker}
    />
  );

  return (
    <>
      <form
        ref={(element) => {
          form = element;
        }}
        class="composer"
        aria-label="Message composer"
        data-dropping={dropping() ? "true" : undefined}
        onSubmit={submit}
      >
        <input
          ref={(element) => {
            fileInput = element;
          }}
          class="composer-file-input"
          type="file"
          multiple
          hidden
          onChange={onPickerChange}
        />
        <Show
          when={
            review() ||
            annotations() ||
            browserBatches().length > 0 ||
            (props.files?.length ?? 0) > 0 ||
            attachments() !== undefined
          }
        >
          <AttachmentPills>
            <Show when={review()}>
              {(item) => (
                <AttachmentDetailPill
                  kind="review"
                  label={`Review · ${item().comments.length}`}
                  title="Review comments"
                  disabled={props.readOnly}
                  onRemove={(button) => item().onDiscard(button)}
                  removeLabel={`Discard ${item().comments.length} code review comments`}
                >
                  <ReviewAttachmentDetails comments={item().comments} />
                </AttachmentDetailPill>
              )}
            </Show>
            <Show when={annotations()}>
              {(annotation) => (
                <AttachmentDetailPill
                  kind="annotations"
                  label={`Annotations · ${annotation().count}`}
                  title="Transcript annotations"
                  triggerRef={annotation().ref}
                  onOpen={annotation().onOpen}
                  expanded={annotation().expanded}
                  controls={annotation().controls}
                  onRemove={annotation().onDiscard}
                  removeLabel={`Discard ${annotation().count} annotations`}
                  disabled={props.readOnly || props.disabled || props.action === "sending"}
                />
              )}
            </Show>
            <BrowserAttachments
              batches={browserBatches()}
              disabled={props.readOnly}
              onRemoveBatch={props.onRemoveBrowserBatch}
              onRemoveFile={props.onRemoveFile}
              onRemoved={() => editor?.focus()}
            />
            <For each={ordinaryFiles()}>
              {(file) =>
                isImageFile(file) ? (
                  <AttachmentImagePill
                    file={file}
                    alt={file.name || "Pasted image"}
                    name={file.name || "Pasted image"}
                    class="composer-file-preview"
                    disabled={props.readOnly}
                    onRemove={() => {
                      if (props.readOnly) return;
                      props.onRemoveFile?.(file);
                      editor?.focus();
                    }}
                  />
                ) : (
                  <AttachmentFilePill
                    name={file.name || "Pasted file"}
                    disabled={props.readOnly}
                    onRemove={() => {
                      if (props.readOnly) return;
                      props.onRemoveFile?.(file);
                      editor?.focus();
                    }}
                  />
                )
              }
            </For>
            <Show when={(props.attachments?.count ?? 0) > 0}>{props.attachments?.content}</Show>
          </AttachmentPills>
        </Show>
        <Show
          when={
            props.command !== undefined && (review() !== undefined || annotations() !== undefined)
          }
        >
          <p class="composer-status composer-kept-notice" role="status">
            Review comments and annotations stay attached for your next message.
          </p>
        </Show>
        <div class="composer-editor-row">
          <PromptEditor
            ref={(element) => {
              editor = element;
            }}
            control={(value) => {
              editorControl = value;
            }}
            readOnly={props.readOnly}
            value={props.value}
            skills={props.skills}
            catalog={props.catalog}
            sessionID={props.sessionID}
            onInput={props.onInput}
            onKeyDown={keyDown}
            placeholder={props.action === "running" ? "Draft your next prompt…" : "Send a message…"}
          />
        </div>

        <div class="composer-controls-row">
          {selectionControls(props, attachButton())}
          <Tooltip class="composer-action-tooltip" value={sendTooltip()}>
            <button
              class="composer-action"
              data-action={stopping() ? "stop" : "send"}
              type={stopping() ? "button" : "submit"}
              aria-label={stopping() ? "Stop" : "Send"}
              disabled={stopping() ? props.onStop === undefined : !canSubmit()}
              onClick={(event) => {
                if (!stopping()) return;
                // Stopping may synchronously turn this same button into a submit button.
                event.preventDefault();
                props.onStop?.();
              }}
            >
              {stopping() ? (
                <Icon name="stop" size="small" aria-hidden="true" />
              ) : (
                <span class="composer-action-icon" aria-hidden="true">
                  {props.action === "sending" ? (
                    <Loader width={16} height={16} />
                  ) : (
                    <Icon name="arrow-up" />
                  )}
                </span>
              )}
            </button>
          </Tooltip>
        </div>

        {selectionStatus(props)}
        {props.actions}

        <Show when={dropping()}>
          <div class="composer-drop-overlay" aria-hidden="true">
            Drop files to add
          </div>
        </Show>
      </form>
    </>
  );
}
