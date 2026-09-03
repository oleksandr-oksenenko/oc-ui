import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";

export function ContextMessage(props: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly description?: string;
}): JSX.Element {
  return (
    <Collapsible
      class="transcript-message transcript-context-message"
      data-message-id={props.id}
      defaultOpen={false}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="outline-dots" size="small" aria-hidden="true" />
        <span class="transcript-context-label">{props.label}</span>
        <Show when={props.description}>
          <span class="transcript-context-detail">{props.description}</span>
        </Show>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre data-annotation-block={annotationBlock("body")} class="transcript-context-text">
          {props.text}
        </pre>
      </Collapsible.Content>
    </Collapsible>
  );
}
