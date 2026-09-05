import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect } from "solid-js";

import "./Composer/Composer.css";
import { AgentPicker } from "./Composer/AgentPicker.tsx";
import type { AgentPickerOption } from "./Composer/AgentPicker.tsx";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";

const COMPOSER_MIN_HEIGHT = 40;
const COMPOSER_MAX_HEIGHT = 168;

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

export type ComposerProps = {
  readonly value: string;
  /** The one action represented by the composer button. */
  readonly action: "send" | "sending" | "running";
  /** Disables the action currently represented by the composer button. */
  readonly disabled: boolean;
  readonly error?: string;
  /** Omitted review state is equivalent to an empty review attachment. */
  readonly review?: ComposerReview;
  /** Omitted annotations state is equivalent to an empty annotation attachment. */
  readonly annotations?: ComposerAnnotations;
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
  readonly onInput: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onStop?: () => void;
};

function selectionControls(
  props: Pick<ComposerProps, "action" | "agentSelection" | "modelSelection">,
) {
  return (
    <div class="composer-v2-picker-row">
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
        <p class="composer-v2-status composer-v2-status--error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.agentSelection.switching ? (
        <p class="composer-v2-status" role="status">
          Switching agent…
        </p>
      ) : null}
      {props.modelSelection.switching ? (
        <p class="composer-v2-status" role="status">
          Switching selection…
        </p>
      ) : null}
      {props.modelSelection.error ? (
        <p class="composer-v2-status composer-v2-status--error" role="alert">
          {props.modelSelection.error}
        </p>
      ) : null}
      {props.agentSelection.error ? (
        <p class="composer-v2-status composer-v2-status--error" role="alert">
          {props.agentSelection.error}
        </p>
      ) : null}
    </>
  );
}

export function Composer(props: ComposerProps) {
  let textarea: HTMLTextAreaElement | undefined;
  const review = () => props.review;
  const annotations = () => ((props.annotations?.count ?? 0) > 0 ? props.annotations : undefined);
  const resizeTextarea = () => {
    if (!textarea) return;
    textarea.style.height = "0px";
    const scrollHeight = textarea.scrollHeight;
    const height = Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, scrollHeight));
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  };

  createEffect(() => {
    void props.value;
    resizeTextarea();
  });

  const sendable = () =>
    review() !== undefined || annotations() !== undefined || props.value.trim() !== "";

  const canSubmit = () =>
    !props.disabled &&
    props.action === "send" &&
    !props.modelSelection.switching &&
    !props.agentSelection.switching &&
    sendable();

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (!canSubmit()) return;
    props.onSubmit();
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== "Enter" || event.shiftKey)
      return;
    event.preventDefault();
    submit();
  };

  return (
    <form class="composer-v2 oc-focus-container" aria-label="Message composer" onSubmit={submit}>
      {review() ? (
        <div class="composer-v2-review-row">
          <span class="composer-v2-review-label">
            Code review · {review()!.count} {review()!.count === 1 ? "comment" : "comments"}
          </span>
          <IconButton
            class="composer-v2-review-discard"
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
          <div class="composer-v2-annotation-row">
            <Button
              class="composer-v2-annotation-count"
              ref={annotation().ref}
              type="button"
              size="small"
              variant="ghost-muted"
              onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
                annotation().onOpen(event.currentTarget);
              }}
            >
              Annotations · {annotation().count} {annotation().count === 1 ? "comment" : "comments"}
            </Button>
            <IconButton
              class="composer-v2-annotation-discard"
              disabled={props.disabled || props.action !== "send"}
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
      <div class="composer-v2-editor-row">
        <textarea
          ref={(element) => {
            textarea = element;
          }}
          class="composer-v2-input oc-focus-delegate"
          aria-label="Prompt"
          disabled={false}
          placeholder={props.action === "running" ? "Draft your next prompt…" : "Send a message…"}
          rows={1}
          value={props.value}
          onInput={(event) => {
            props.onInput(event.currentTarget.value);
            resizeTextarea();
          }}
          onKeyDown={keyDown}
        />
      </div>

      <div class="composer-v2-controls-row">
        {selectionControls(props)}
        <button
          class="composer-v2-action"
          type={props.action === "running" ? "button" : "submit"}
          aria-label={props.action === "running" ? "Stop" : "Send"}
          title={props.action === "running" ? "Stop" : "Send"}
          disabled={
            props.disabled ||
            props.action === "sending" ||
            (props.action === "running" && props.onStop === undefined) ||
            (props.action === "send" &&
              (props.modelSelection.switching || props.agentSelection.switching || !sendable()))
          }
          onClick={(event) => {
            if (props.action !== "running") return;
            // Stopping may synchronously turn this same button into a submit button.
            event.preventDefault();
            props.onStop?.();
          }}
        >
          {props.action === "running" ? (
            <Icon name="stop" size="small" aria-hidden="true" />
          ) : (
            <span class="composer-v2-action-icon" aria-hidden="true">
              {props.action === "sending" ? (
                <Loader width={16} height={16} />
              ) : (
                <Icon name="arrow-up" />
              )}
            </span>
          )}
        </button>
      </div>

      {selectionStatus(props)}
    </form>
  );
}
