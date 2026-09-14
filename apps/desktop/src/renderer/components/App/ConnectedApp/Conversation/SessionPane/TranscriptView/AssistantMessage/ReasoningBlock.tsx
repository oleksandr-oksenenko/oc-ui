import type { SessionMessageAssistantReasoning } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

import { createDeferredCollapsibleMount } from "../createDeferredCollapsibleMount.ts";

export type ReasoningBlockProps = {
  readonly annotationBlock?: string;
  readonly reasoning: SessionMessageAssistantReasoning;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  const content = createDeferredCollapsibleMount();
  return (
    <Collapsible
      class="transcript-reasoning"
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="brain" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Reasoning</span>
      </Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content>
          <p data-annotation-block={props.annotationBlock} class="transcript-reasoning-summary">
            {props.reasoning.text}
          </p>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
