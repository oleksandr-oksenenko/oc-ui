import type { SessionMessageCompaction } from "@opencode/client";
import { Collapsible } from "@opencode/ui/collapsible";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "@opencode/ui/loader";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../../../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "../../../createDeferredCollapsibleMount.ts";

type CompactionDetails = Extract<SessionMessageCompaction, { status: "running" | "completed" }>;
type CompactionFailure = Extract<SessionMessageCompaction, { status: "failed" }>;

/**
 * A compaction can fail while its row stays mounted, so the failure body is a
 * narrowed view of the reactive message rather than a snapshot of its status.
 */
function isCompactionFailure(message: SessionMessageCompaction): message is CompactionFailure {
  return message.status === "failed";
}

function isCompactionDetails(message: SessionMessageCompaction): message is CompactionDetails {
  return message.status !== "failed";
}

export function CompactionMessage(props: {
  readonly message: SessionMessageCompaction;
}): JSX.Element {
  const content = createDeferredCollapsibleMount();
  const failure = () => (isCompactionFailure(props.message) ? props.message : undefined);
  const details = () => (isCompactionDetails(props.message) ? props.message : undefined);
  return (
    <Collapsible
      class={`transcript-message transcript-compaction transcript-compaction-${props.message.status}`}
      data-message-id={props.message.id}
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
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
      {/* Always mounted, outside the trigger: a failure is announced even when the
          reader never opens the row's deferred details, and the trigger's
          accessible name stays concise. */}
      <Show when={failure()}>
        {(message) => (
          <p class="sr-only" role="alert">
            Compaction failed: {message().error.message}
          </p>
        )}
      </Show>
      <Show when={content.mount()}>
        <Collapsible.Content>
          <Show when={failure()}>
            {(message) => (
              <p
                data-annotation-block={annotationBlock("compaction", "error")}
                class="transcript-context-text"
              >
                {message().error.message}
              </p>
            )}
          </Show>
          <Show when={details()}>
            {(message) => (
              <>
                <p
                  data-annotation-block={annotationBlock("compaction", "summary")}
                  data-annotation-disabled={message().status === "running" ? "true" : undefined}
                  class="transcript-context-text"
                >
                  {message().summary}
                </p>
                <p
                  data-annotation-block={annotationBlock("compaction", "recent")}
                  data-annotation-disabled={message().status === "running" ? "true" : undefined}
                  class="transcript-context-text"
                >
                  Recent: {message().recent}
                </p>
              </>
            )}
          </Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
