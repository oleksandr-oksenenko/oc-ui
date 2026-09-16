import type { CommandInfo, PromptSkillAttachment, SkillInfo } from "@opencode-ai/client";
import { PromptEditor } from "./Composer/PromptEditor.tsx";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Loader } from "@opencode-ai/ui/loader";
import { Tooltip } from "@opencode-ai/ui/tooltip";
import { For, Show } from "solid-js";

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
  readonly onPasteFiles?: (files: readonly File[]) => void;
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
) {
  return (
    <div class="composer-picker-row">
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

  return (
    <>
      <form class="composer oc-focus-container" aria-label="Message composer" onSubmit={submit}>
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
          <ul class="composer-files" aria-label="Attached files">
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
            onPasteFiles={props.onPasteFiles}
            onKeyDown={keyDown}
            placeholder={props.action === "running" ? "Draft your next prompt…" : "Send a message…"}
          />
        </div>

        <div class="composer-controls-row">
          {selectionControls(props)}
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
      </form>
    </>
  );
}
