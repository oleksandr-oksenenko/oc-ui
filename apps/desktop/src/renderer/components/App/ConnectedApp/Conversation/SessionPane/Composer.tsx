import { createEffect } from "solid-js";

import "./Composer/Composer.css";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";

const COMPOSER_MIN_HEIGHT = 40;
const COMPOSER_MAX_HEIGHT = 168;

export type ComposerProps = {
  readonly value: string;
  /** Disables submission while the current session cannot accept a prompt. */
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly running: boolean;
  readonly error?: string;
  readonly selection: {
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
  readonly onInput: (value: string) => void;
  readonly onSubmit: () => void;
};

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
    if (props.disabled || props.submitting || props.running || props.value.trim() === "") return;
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
          placeholder={props.running ? "Draft your next prompt…" : "Send a message…"}
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
        <div class="composer-v2-picker-row">
          {props.selection.state === "ready" ? (
            <>
              <ModelPicker
                options={props.selection.models}
                selectedID={props.selection.selectedModelID}
                disabled={props.selection.disabled || props.selection.switching}
                onSelect={props.selection.onSelectModel}
              />
              <VariantPicker
                placeholder="Select variant"
                unavailableLabel={
                  props.selection.selectedModelID === undefined
                    ? "Variant unavailable"
                    : "No variants"
                }
                options={props.selection.variants}
                selectedID={props.selection.selectedVariantID}
                disabled={props.selection.disabled || props.selection.switching}
                onSelect={props.selection.onSelectVariant}
              />
            </>
          ) : (
            <>
              <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
                {props.selection.state === "loading" ? "Loading models…" : "Models unavailable"}
              </span>
              <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
                {props.selection.state === "loading" ? "Loading variants…" : "Variants unavailable"}
              </span>
            </>
          )}
        </div>
        <button
          class="composer-v2-send"
          type="submit"
          aria-label="Send"
          title="Send"
          disabled={
            props.disabled || props.submitting || props.running || props.value.trim() === ""
          }
        >
          <span class="composer-v2-send-icon" aria-hidden="true">
            {props.submitting ? "…" : "↑"}
          </span>
        </button>
      </div>

      {props.error ? (
        <p class="composer-v2-status composer-v2-status--error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.selection.switching ? (
        <p class="composer-v2-status" role="status">
          Switching selection…
        </p>
      ) : null}
      {props.selection.error ? (
        <p class="composer-v2-status composer-v2-status--error" role="alert">
          {props.selection.error}
        </p>
      ) : null}
    </form>
  );
}
