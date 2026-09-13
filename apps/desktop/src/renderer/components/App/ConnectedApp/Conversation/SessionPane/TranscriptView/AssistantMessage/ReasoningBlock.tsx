import type { SessionMessageAssistantReasoning } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly annotationBlock?: string;
  readonly reasoning: SessionMessageAssistantReasoning;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  return (
    <Collapsible class="transcript-reasoning" defaultOpen={false}>
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="brain" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Reasoning</span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p data-annotation-block={props.annotationBlock} class="transcript-reasoning-summary">
          {props.reasoning.text}
        </p>
      </Collapsible.Content>
    </Collapsible>
  );
}
