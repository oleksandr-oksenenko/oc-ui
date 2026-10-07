/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable process output needs keyboard access. */
import { Collapsible } from "@opencode/ui/collapsible";
import { Icon } from "@opencode/ui/icon";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../../../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "../../../createDeferredCollapsibleMount.ts";
import type { backgroundProcessUpdate } from "./backgroundProcessUpdate.ts";

export function BackgroundProcessMessage(props: {
  readonly id: string;
  readonly update: NonNullable<ReturnType<typeof backgroundProcessUpdate>>;
}): JSX.Element {
  const content = createDeferredCollapsibleMount();
  return (
    <Collapsible
      class="transcript-message transcript-context-message transcript-background-message"
      data-message-id={props.id}
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
    >
      <Collapsible.Trigger class="transcript-context-trigger">
        <Icon name="terminal" size="small" aria-hidden="true" />
        <span class="transcript-context-label">Background process</span>
        <span class="transcript-context-detail">
          {props.update.command.replace(/\s+/g, " ").trim()}
        </span>
        <span class="transcript-context-status" data-status={props.update.status}>
          <Icon
            name={
              props.update.status === "success"
                ? "check"
                : props.update.status === "error"
                  ? "warning"
                  : "circle-xmark"
            }
            size="small"
            aria-hidden="true"
          />
          <span>{props.update.label}</span>
        </span>
      </Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content>
          <div class="transcript-shell-details">
            <span>Process: {props.update.jobID}</span>
            <pre class="transcript-background-command">{props.update.command}</pre>
            <pre
              data-annotation-block={annotationBlock("background", "output")}
              class="transcript-tool-output oc-scrollable"
              tabIndex={0}
            >
              {props.update.output}
            </pre>
            <Show when={props.update.truncated}>
              <span>Output truncated</span>
            </Show>
          </div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
