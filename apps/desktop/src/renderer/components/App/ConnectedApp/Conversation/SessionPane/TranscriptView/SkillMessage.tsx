import type { SessionMessageSkill } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "./createDeferredCollapsibleMount.ts";

export function SkillMessage(props: { readonly message: SessionMessageSkill }): JSX.Element {
  const content = createDeferredCollapsibleMount();
  return (
    <Collapsible
      class="transcript-message transcript-skill-message"
      data-message-id={props.message.id}
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="post-skill" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Skill: {props.message.name}</span>
      </Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content>
          <pre data-annotation-block={annotationBlock("body")} class="transcript-context-text">
            {props.message.text}
          </pre>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
