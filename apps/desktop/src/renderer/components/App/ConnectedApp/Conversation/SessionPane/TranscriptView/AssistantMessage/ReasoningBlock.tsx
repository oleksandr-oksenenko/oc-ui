import type { SessionMessageAssistantReasoning } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly annotationBlock?: string;
  readonly reasoning: SessionMessageAssistantReasoning;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  const duration = () => {
    const time = props.reasoning.time;
    if (!time?.completed) return undefined;
    return formatDuration(time.completed - time.created);
  };

  return (
    <Collapsible class="transcript-reasoning" defaultOpen={false}>
      <Collapsible.Trigger class="transcript-reasoning-toggle">
        <Icon name="brain" size="small" aria-hidden="true" />
        <span class="transcript-reasoning-label">Reasoning</span>
        <Show when={duration()}>
          {(value) => <span class="transcript-reasoning-duration">· {value()}</span>}
        </Show>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p data-annotation-block={props.annotationBlock} class="transcript-reasoning-summary">
          {props.reasoning.text}
        </p>
      </Collapsible.Content>
    </Collapsible>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${seconds}s`;
}
