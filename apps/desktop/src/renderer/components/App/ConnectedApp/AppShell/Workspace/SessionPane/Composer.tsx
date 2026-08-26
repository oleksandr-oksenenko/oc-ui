import { IconButton } from "@opencode-ai/ui/icon-button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Textarea } from "@opencode-ai/ui/textarea";
import { Show, createEffect, on } from "solid-js";

import { ComposerPicker, type ComposerPickerProps } from "./Composer/ComposerPicker.tsx";
import "./Composer/Composer.css";

export type ComposerProps = {
  readonly value: string;
  /** Disables submission while the current session cannot accept a prompt. */
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly running: boolean;
  readonly error?: string;
  readonly onInput: (value: string) => void;
  readonly onSubmit: () => void;
  /** Optional provider-neutral model choices. Omit until runtime discovery is available. */
  readonly model?: ComposerPickerProps;
  /** Optional provider-neutral reasoning choices. Omit until runtime discovery is available. */
  readonly reasoning?: ComposerPickerProps;
};

const MAX_INPUT_HEIGHT = 168;
const MIN_INPUT_HEIGHT = 40;

export function Composer(props: ComposerProps) {
  let textarea: HTMLTextAreaElement | undefined;

  const resizeInput = () => {
    if (!textarea) return;
    textarea.style.height = "auto";
    const contentHeight = Math.max(textarea.scrollHeight, MIN_INPUT_HEIGHT);
    const height = Math.min(contentHeight, MAX_INPUT_HEIGHT);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = contentHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  };

  createEffect(on(() => props.value, resizeInput));

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (props.disabled || props.submitting || props.running || props.value.trim() === "") return;
    props.onSubmit();
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    submit();
  };

  return (
    <form class="composer-v2" aria-label="Message composer" onSubmit={submit}>
      <div class="composer-v2-editor-row">
        <Textarea
          class="composer-v2-input"
          aria-label="Prompt"
          disabled={false}
          placeholder={props.running ? "Draft your next prompt…" : "Send a message…"}
          rows={1}
          value={props.value}
          ref={(element) => {
            textarea = element;
            resizeInput();
          }}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={keyDown}
        />
      </div>

      <div class="composer-v2-controls-row">
        <Show when={props.model || props.reasoning}>
          <div class="composer-v2-picker-row">
            <Show when={props.model}>{(model) => <ComposerPicker {...model()} />}</Show>
            <Show when={props.reasoning}>{(reasoning) => <ComposerPicker {...reasoning()} />}</Show>
          </div>
        </Show>
        <IconButton
          class="composer-v2-send"
          type="submit"
          variant="contrast"
          size="large"
          aria-label="Send"
          title="Send"
          disabled={
            props.disabled || props.submitting || props.running || props.value.trim() === ""
          }
          icon={
            <Show
              when={!props.submitting}
              fallback={<Loader class="composer-v2-send-icon--loading" aria-hidden="true" />}
            >
              <Icon name="arrow-up" aria-hidden="true" />
            </Show>
          }
        />
      </div>

      <Show when={props.error}>
        {(error) => (
          <p class="composer-v2-status composer-v2-status--error" role="alert">
            {error()}
          </p>
        )}
      </Show>
      <Show when={!props.error && props.running}>
        <output class="composer-v2-status">Draft saved while this run finishes.</output>
      </Show>
    </form>
  );
}
