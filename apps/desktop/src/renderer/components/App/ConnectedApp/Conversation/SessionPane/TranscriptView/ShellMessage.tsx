import type { SessionMessageShell } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";

export function ShellMessage(props: { readonly message: SessionMessageShell }): JSX.Element {
  const output = props.message.output?.output;
  const hasDetails = output !== undefined || props.message.exit !== undefined;
  return (
    <Collapsible
      class={`transcript-message transcript-shell-message transcript-shell-${props.message.status}`}
      data-message-id={props.message.id}
      defaultOpen={false}
    >
      <Collapsible.Trigger class="transcript-context-trigger" disabled={!hasDetails}>
        <Icon name="terminal" size="small" aria-hidden="true" />
        <span class="transcript-context-label">{props.message.command}</span>
        <span class="transcript-context-status" data-status={shellSemanticStatus(props.message)}>
          <Show
            when={props.message.status === "running"}
            fallback={
              <Icon
                name={shellSemanticStatus(props.message) === "success" ? "check" : "warning"}
                size="small"
                aria-hidden="true"
              />
            }
          >
            <Loader width={14} height={14} aria-hidden="true" />
          </Show>
          <span>{shellStatus(props.message)}</span>
        </span>
        <Show when={hasDetails}>
          <Collapsible.Arrow />
        </Show>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="transcript-shell-details">
          <Show when={props.message.exit !== undefined}>
            <span>Exit: {String(props.message.exit)}</span>
          </Show>
          <Show when={output !== undefined}>
            <pre
              data-annotation-block={annotationBlock("shell", "output")}
              data-annotation-disabled={props.message.status === "running" ? "true" : undefined}
              class="transcript-tool-output oc-scrollable"
            >
              {output}
            </pre>
          </Show>
          <Show when={props.message.output?.truncated === true}>
            <span>Output truncated</span>
          </Show>
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}

function shellStatus(message: SessionMessageShell): string {
  switch (message.status) {
    case "running":
      return "Running";
    case "exited":
      return message.exit === 0 ? "Completed" : `Exited ${String(message.exit ?? "")}`.trim();
    case "timeout":
      return "Timed out";
    case "killed":
      return "Killed";
    default: {
      const unreachable: never = message.status;
      return unreachable;
    }
  }
}

function shellSemanticStatus(message: SessionMessageShell): "running" | "success" | "error" {
  return message.status === "running"
    ? "running"
    : message.status === "exited" && message.exit === 0
      ? "success"
      : "error";
}
