import type { SessionMessageAssistantReasoning } from "@opencode-ai/client";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly reasoning: SessionMessageAssistantReasoning;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  let trigger: HTMLElement | undefined;
  const duration = () => {
    const time = props.reasoning.time;
    if (!time?.completed) return undefined;
    return formatDuration(time.completed - time.created);
  };

  return (
    <details
      class="transcript-reasoning"
      onToggle={(event) => {
        trigger?.setAttribute("aria-expanded", event.currentTarget.open ? "true" : "false");
      }}
    >
      <summary
        ref={(element) => {
          trigger = element;
        }}
        class="transcript-reasoning-toggle"
        data-slot="collapsible-trigger"
        aria-expanded="false"
      >
        <Icon name="brain" size="small" aria-hidden="true" />
        <span class="transcript-reasoning-label">Reasoning</span>
        <Show when={duration()}>
          {(value) => <span class="transcript-reasoning-duration">· {value()}</span>}
        </Show>
        <span data-slot="collapsible-arrow" aria-hidden="true">
          ›
        </span>
      </summary>
      <div data-slot="collapsible-content">
        <p class="transcript-reasoning-summary">{props.reasoning.text}</p>
      </div>
    </details>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${seconds}s`;
}
