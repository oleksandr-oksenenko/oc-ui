import { Button } from "@opencode-ai/ui/button";
import { Textarea } from "@opencode-ai/ui/textarea";
import { Show } from "solid-js";

export type ComposerProps = {
  readonly value: string;
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly running: boolean;
  readonly error?: string;
  readonly onInput: (value: string) => void;
  readonly onSubmit: () => void;
};

export function Composer(props: ComposerProps) {
  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    if (!props.disabled && props.value.trim() !== "") props.onSubmit();
  };

  return (
    <footer class="composer">
      <Textarea
        aria-label="Prompt"
        disabled={false}
        placeholder={
          props.running
            ? "Draft your next prompt while OpenCode works…"
            : "Send a message to OpenCode…"
        }
        rows={3}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={keyDown}
      />
      <div class="composer-footer">
        <div>
          <Show when={props.error}>
            {(error) => (
              <p class="operation-error" role="alert">
                {error()}
              </p>
            )}
          </Show>
          <Show when={!props.error && props.running}>
            <p class="composer-hint">
              You can keep drafting. Send becomes available when this run finishes.
            </p>
          </Show>
        </div>
        <Button
          type="button"
          variant={props.submitting ? "loading" : "contrast"}
          disabled={props.disabled || props.value.trim() === ""}
          onClick={props.onSubmit}
        >
          {props.submitting ? "Sending" : "Send"}
        </Button>
      </div>
    </footer>
  );
}
