import { Icon } from "@opencode-ai/ui/icon";
import type { JSX } from "solid-js";

export function TimelineRow(props: {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
}): JSX.Element {
  return (
    <div class="transcript-message transcript-timeline-row" data-message-id={props.id}>
      <Icon name={props.icon} size="small" aria-hidden="true" />
      <span class="transcript-context-label">{props.label}</span>
      <span class="transcript-context-detail">{props.detail}</span>
    </div>
  );
}
