import type { SessionMessageSkill } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import type { JSX } from "solid-js";

export function SkillMessage(props: { readonly message: SessionMessageSkill }): JSX.Element {
  return (
    <Collapsible
      class="transcript-message transcript-skill-message"
      data-message-id={props.message.id}
      defaultOpen={false}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="prompt" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Skill: {props.message.name}</span>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre class="transcript-context-text">{props.message.text}</pre>
      </Collapsible.Content>
    </Collapsible>
  );
}
