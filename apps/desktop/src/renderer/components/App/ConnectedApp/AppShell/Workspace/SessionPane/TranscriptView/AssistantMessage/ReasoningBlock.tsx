import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly summary: string;
  readonly label?: string;
  readonly duration?: string;
  readonly defaultOpen?: boolean;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  return (
    <Collapsible class="transcript-reasoning" defaultOpen={props.defaultOpen ?? false}>
      <Collapsible.Trigger class="transcript-reasoning-toggle">
        <Icon name="brain" size="small" aria-hidden="true" />
        <span class="transcript-reasoning-label">{props.label ?? "Reasoning summary"}</span>
        <Show when={props.duration}>
          {(duration) => <span class="transcript-reasoning-duration">· {duration()}</span>}
        </Show>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p class="transcript-reasoning-summary">{props.summary}</p>
      </Collapsible.Content>
    </Collapsible>
  );
}
