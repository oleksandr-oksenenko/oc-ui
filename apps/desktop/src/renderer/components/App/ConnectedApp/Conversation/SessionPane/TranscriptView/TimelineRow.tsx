import { Icon } from "@opencode/ui/icon";
import type { JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";

export function TimelineRow(props: {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
}): JSX.Element {
  return (
    <div class="transcript-message transcript-timeline-row" data-message-id={props.id}>
      <Icon name={props.icon} size="small" aria-hidden="true" />
      <span
        data-annotation-block={annotationBlock("timeline", "label")}
        class="transcript-context-label"
      >
        {props.label}
      </span>
      <span
        data-annotation-block={annotationBlock("timeline", "detail")}
        class="transcript-context-detail"
      >
        {props.detail}
      </span>
    </div>
  );
}
