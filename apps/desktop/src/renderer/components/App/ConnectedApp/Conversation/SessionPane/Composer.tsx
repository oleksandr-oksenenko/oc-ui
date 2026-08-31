import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { createEffect } from "solid-js";

import "./Composer/Composer.css";
import { AgentPicker } from "./Composer/AgentPicker.tsx";
import type { AgentPickerOption } from "./Composer/AgentPicker.tsx";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";

const COMPOSER_MIN_HEIGHT = 40;
const COMPOSER_MAX_HEIGHT = 168;

export type ComposerProps = {
  readonly value: string;
  /** The one action represented by the composer button. */
  readonly action: "send" | "sending" | "running";
  /** Disables the action currently represented by the composer button. */
  readonly disabled: boolean;
  readonly error?: string;
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

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (
      props.disabled ||
      props.action !== "send" ||
      props.modelSelection.switching ||
      props.agentSelection.switching ||
      props.value.trim() === ""
    )
      return;
    props.onSubmit();
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <form class="composer-v2" aria-label="Message composer" onSubmit={submit}>
      <div class="composer-v2-editor-row">
        <textarea
          ref={(element) => {
            textarea = element;
          }}
          class="composer-v2-input"
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
              (props.modelSelection.switching ||
                props.agentSelection.switching ||
                props.value.trim() === ""))
          }
          onClick={() => {
            if (props.action === "running") props.onStop?.();
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
