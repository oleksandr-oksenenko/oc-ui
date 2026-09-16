import type { CommandInfo, PromptSkillAttachment, SkillInfo } from "@opencode/client";
import { PromptEditor } from "./Composer/PromptEditor.tsx";
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import { Tooltip } from "@opencode/ui/tooltip";
import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { collectTransferFiles, isFileTransfer } from "../../../../../opencode/attachments.ts";
import { ImagePreview, isImageFile } from "../../../../../ui/ImagePreview.tsx";
import "./Composer/Composer.css";
import { AgentPicker } from "./Composer/AgentPicker.tsx";
import type { AgentPickerOption } from "./Composer/AgentPicker.tsx";
import { ContextMeter } from "./Composer/ContextMeter.tsx";
import type { ContextUsage } from "./Composer/context-usage.ts";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";

export type ComposerReview = {
  readonly count: number;
  readonly onDiscard: (opener: HTMLButtonElement) => void;
};

type ComposerAnnotations = {
  readonly ref?: (button: HTMLButtonElement) => void;
  readonly count: number;
  readonly onOpen: (opener: HTMLButtonElement) => void;
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

export type ComposerProps = {
  readonly value: string;
  readonly sessionID?: string;
  readonly skills?: readonly PromptSkillAttachment[];
  readonly catalog?: ComposerCatalog;
  readonly files?: readonly File[];
  readonly onAttachFiles?: (files: readonly File[]) => void;
  readonly onRemoveFile?: (file: File) => void;
  /** Session execution and prompt admission state. */
  readonly action: "send" | "sending" | "running";
  /** Disables submission. Omit onStop when stopping is unavailable. */
  readonly disabled: boolean;
  readonly error?: string;
  /** A recognized command invocation that leaves comments for the next message. */
  readonly command?: string;
  /** Omitted review state is equivalent to an empty review attachment. */
  readonly review?: ComposerReview;
  /** Omitted annotations state is equivalent to an empty annotation attachment. */
  readonly annotations?: ComposerAnnotations;
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
  };
  readonly agentSelection: {
    readonly state: "loading" | "ready" | "failed";
    readonly switching: boolean;
    readonly disabled: boolean;
    readonly agents: readonly AgentPickerOption[];
    readonly selectedAgentID?: string;
    readonly error?: string;
    readonly onSelectAgent: (id: string) => void;
  };
  readonly onInput: (value: string, skills?: readonly PromptSkillAttachment[]) => void;
  readonly onSubmit: () => void;
  /** When supplied, Cmd+Enter submits with queued delivery. */
  readonly onQueue?: () => void;
  readonly onStop?: () => void;
};

function selectionControls(
  props: Pick<ComposerProps, "action" | "agentSelection" | "modelSelection" | "contextUsage">,
  attachButton: JSX.Element,
) {
  return (
    <div class="composer-picker-row">
      {attachButton}
      <Show when={props.contextUsage}>{(usage) => <ContextMeter usage={usage()} />}</Show>
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
        <>
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
        </>
      ) : (
        <>
          <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
            {props.modelSelection.state === "loading" ? "Loading models…" : "Models unavailable"}
          </span>
          <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
            {props.modelSelection.state === "loading"
              ? "Loading variants…"
              : "Variants unavailable"}
          </span>
        </>
      )}
    </div>
  );
}

function selectionStatus(
  props: Pick<ComposerProps, "agentSelection" | "error" | "modelSelection">,
) {
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
      {props.agentSelection.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.agentSelection.error}
        </p>
      ) : null}
    </>
  );
}

export function Composer(props: ComposerProps) {
  let editor: HTMLDivElement | undefined;
  let form: HTMLFormElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let pickerSessionID: string | undefined;
  let dragDepth = 0;
  const [dropping, setDropping] = createSignal(false);
  const canAttach = () => props.onAttachFiles !== undefined;
  const review = () => props.review;
  const annotations = () => ((props.annotations?.count ?? 0) > 0 ? props.annotations : undefined);
  const sendable = () =>
    review() !== undefined ||
    annotations() !== undefined ||
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

  const sendTooltip = () => {
    if (stopping()) return "Stop";
    if (props.onQueue) {
      const steer = props.action === "running" ? "Enter to steer" : "Enter to send";
      return `${steer} · ⌘ Enter to queue · Shift Enter for a new line`;
    }
    return props.action === "running" ? "Send steering message (Enter)" : "Send";
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== "Enter" || event.shiftKey)
      return;
    event.preventDefault();
    if (event.metaKey && props.onQueue) {
      if (canSubmit()) props.onQueue();
      return;
    }
    submit();
  };

  const attach = (incoming: readonly File[]) => {
    if (!canAttach() || incoming.length === 0) return;
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

  const paste = (event: ClipboardEvent) => {
    // Without an attachment owner, leave the payload for normal handling.
    if (!canAttach()) return;
    const files = collectTransferFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    // Capture-phase stop so ProseMirror does not also receive the file payload.
    event.stopPropagation();
    attach(files);
  };

  onMount(() => {
    const element = form;
    if (element === undefined) return;
    // Capture phase so files are taken before ProseMirror handles the event;
    // Solid does not delegate drag or paste events.
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
        class="composer oc-focus-container"
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
        {review() ? (
          <div class="composer-review-row">
            <span class="composer-review-label">
              Code review · {review()!.count} {review()!.count === 1 ? "comment" : "comments"}
            </span>
            <IconButton
              class="composer-review-discard"
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={`Discard ${review()!.count} code review comments`}
              title={`Discard ${review()!.count} code review comments`}
              icon={<Icon name="close" size="small" aria-hidden="true" />}
              onClick={(event) => {
                review()?.onDiscard(event.currentTarget);
              }}
            />
          </div>
        ) : null}
        <Show when={annotations()}>
          {(annotation) => (
            <div class="composer-annotation-row">
              <Button
                class="composer-annotation-count"
                ref={annotation().ref}
                type="button"
                size="small"
                variant="ghost-muted"
                onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
                  annotation().onOpen(event.currentTarget);
                }}
              >
                Annotations · {annotation().count}{" "}
                {annotation().count === 1 ? "comment" : "comments"}
              </Button>
              <IconButton
                class="composer-annotation-discard"
                disabled={props.disabled || props.action === "sending"}
                type="button"
                size="small"
                variant="ghost-muted"
                aria-label={`Discard ${annotation().count} annotations`}
                title={`Discard ${annotation().count} annotations`}
                icon={<Icon name="close" size="small" aria-hidden="true" />}
                onClick={(event) => {
                  annotation().onDiscard(event.currentTarget);
                }}
              />
            </div>
          )}
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
        <Show when={(props.files?.length ?? 0) > 0}>
          <ul class="composer-files" aria-label="Images and files">
            <For each={props.files ?? []}>
              {(file) => (
                <li class="composer-file">
                  <Show
                    when={isImageFile(file)}
                    fallback={
                      <span class="composer-file-name" title={file.name || "Pasted file"}>
                        {file.name || "Pasted file"}
                      </span>
                    }
                  >
                    <ImagePreview
                      file={file}
                      alt={file.name || "Pasted image"}
                      class="composer-file-preview"
                    />
                  </Show>
                  <IconButton
                    class="composer-file-remove"
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    aria-label={`Remove ${file.name || "Pasted file"}`}
                    icon={<Icon name="close" size="small" aria-hidden="true" />}
                    onClick={() => {
                      props.onRemoveFile?.(file);
                      editor?.focus();
                    }}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="composer-editor-row">
          <PromptEditor
            ref={(element) => {
              editor = element;
            }}
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

        <Show when={dropping()}>
          <div class="composer-drop-overlay" aria-hidden="true">
            Drop files to add
          </div>
        </Show>
      </form>
    </>
  );
}
