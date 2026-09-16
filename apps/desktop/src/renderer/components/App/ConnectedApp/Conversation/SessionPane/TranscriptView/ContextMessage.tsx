import { Collapsible } from "@opencode/ui/collapsible";
import { Icon } from "@opencode/ui/icon";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "./createDeferredCollapsibleMount.ts";

export function ContextMessage(props: {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly text: string;
  readonly description?: string;
}): JSX.Element {
  const content = createDeferredCollapsibleMount();
  return (
    <Collapsible
      class="transcript-message transcript-context-message"
      data-message-id={props.id}
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name={props.icon} size="small" aria-hidden="true" />
        <span class="transcript-context-label">{props.label}</span>
        <Show when={props.description}>
          <span class="transcript-context-detail">{props.description}</span>
        </Show>
      </Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content>
          <pre data-annotation-block={annotationBlock("body")} class="transcript-context-text">
            {props.text}
          </pre>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
