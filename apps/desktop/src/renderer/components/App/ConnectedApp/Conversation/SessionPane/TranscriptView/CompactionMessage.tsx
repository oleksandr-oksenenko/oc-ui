import type { SessionMessageCompaction } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, type JSX } from "solid-js";

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
        <Icon name="outline-dots" size="small" aria-hidden="true" />
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
          <span>
            {props.message.status === "completed"
              ? "Completed"
              : props.message.status === "failed"
                ? "Failed"
                : "Running"}
          </span>
        </span>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p class="transcript-context-text">
          {failed ? props.message.error.message : props.message.summary}
        </p>
        <Show when={!failed}>
          <p class="transcript-context-text">
            Recent: {props.message.status === "failed" ? "" : props.message.recent}
          </p>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}
