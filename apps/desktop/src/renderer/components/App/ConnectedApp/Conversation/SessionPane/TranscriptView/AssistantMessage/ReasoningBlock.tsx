import type { SessionMessageAssistantReasoning } from "@opencode-ai/client";
import { Icon } from "@opencode-ai/ui/icon";
import { type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly annotationBlock?: string;
  readonly reasoning: SessionMessageAssistantReasoning;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  return (
    <div class="transcript-reasoning">
      <Icon name="brain" size="small" aria-hidden="true" />
      <p data-annotation-block={props.annotationBlock} class="transcript-reasoning-summary">
        {props.reasoning.text}
      </p>
    </div>
  );
}
