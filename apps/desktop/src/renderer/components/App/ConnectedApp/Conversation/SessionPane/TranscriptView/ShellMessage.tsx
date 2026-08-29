import type { SessionMessageShell } from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Show, type JSX } from "solid-js";

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
        <span class="transcript-context-detail">{shellStatus(props.message)}</span>
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
            <pre class="transcript-tool-output">{output}</pre>
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
      return "Exited";
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
