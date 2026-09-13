import type { SessionMessageCompaction } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";

export function CompactionMessage(props: {
  readonly message: SessionMessageCompaction;
}): JSX.Element {
  const failed = props.message.status === "failed";
  return (
    <Collapsible
      class={`transcript-message transcript-compaction transcript-compaction-${props.message.status}`}
      data-message-id={props.message.id}
      defaultOpen={false}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="collapse" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Compaction</span>
        <span class="transcript-context-detail">{props.message.reason}</span>
        <span
          class="transcript-context-status"
          data-status={
            props.message.status === "completed"
              ? "success"
              : props.message.status === "failed"
                ? "error"
                : "running"
          }
        >
          <Show
            when={props.message.status === "running"}
            fallback={
              <Icon
                name={props.message.status === "completed" ? "check" : "warning"}
                size="small"
                aria-hidden="true"
              />
            }
          >
            <Loader width={14} height={14} aria-hidden="true" />
          </Show>
          <span class="sr-only">
            {props.message.status === "completed"
              ? "Completed"
              : props.message.status === "failed"
                ? "Failed"
                : "Running"}
          </span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p
          data-annotation-block={annotationBlock("compaction", failed ? "error" : "summary")}
          data-annotation-disabled={props.message.status === "running" ? "true" : undefined}
          class="transcript-context-text"
        >
          {failed ? props.message.error.message : props.message.summary}
        </p>
        <Show when={!failed}>
          <p
            data-annotation-block={annotationBlock("compaction", "recent")}
            data-annotation-disabled={props.message.status === "running" ? "true" : undefined}
            class="transcript-context-text"
          >
            Recent: {props.message.status === "failed" ? "" : props.message.recent}
          </p>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}
