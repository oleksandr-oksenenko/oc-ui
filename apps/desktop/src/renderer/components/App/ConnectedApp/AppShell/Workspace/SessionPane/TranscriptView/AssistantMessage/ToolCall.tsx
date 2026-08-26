import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, type JSX } from "solid-js";
import type { ToolCallKind } from "../../transcript-types.ts";

export type ToolCallProps = {
  readonly name: string;
  readonly toolKind?: ToolCallKind;
  readonly target?: string;
  readonly detail?: string;
  readonly status: "running" | "done" | "failed";
  readonly output?: string;
  readonly defaultExpanded?: boolean;
};

export function ToolCall(props: ToolCallProps): JSX.Element {
  const expandable = () => props.output !== undefined && props.output.length > 0;
  const statusLabel = () =>
    props.status === "done" ? "Done" : props.status === "failed" ? "Failed" : "Running";

  return (
    <Collapsible
      class={`transcript-tool-call transcript-tool-${props.status}`}
      defaultOpen={props.defaultExpanded ?? false}
    >
      <Collapsible.Trigger class="transcript-tool-header" disabled={!expandable()}>
        {renderToolIcon(props.toolKind)}
        <span class="transcript-tool-copy">
          <span class="transcript-tool-name">{props.name}</span>
          <Show when={props.target}>
            {(target) => <span class="transcript-tool-target">{target()}</span>}
          </Show>
          <Show when={props.detail}>
            {(detail) => <span class="transcript-tool-detail">{detail()}</span>}
          </Show>
        </span>
        <span class="transcript-tool-status">
          <Show
            when={props.status !== "running"}
            fallback={
              <Loader class="transcript-tool-loader" width={14} height={14} aria-hidden="true" />
            }
          >
            {props.status === "done" ? (
              <Icon name="check" size="small" aria-hidden="true" />
            ) : (
              <Icon name="warning" size="small" aria-hidden="true" />
            )}
          </Show>
          <span>{statusLabel()}</span>
        </span>
        <Show when={expandable()}>
          <Collapsible.Arrow />
        </Show>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Show when={expandable()}>
          <pre class="transcript-tool-output">{props.output}</pre>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}

function renderToolIcon(kind: ToolCallKind | undefined): JSX.Element {
  switch (kind) {
    case "read":
      return <Icon name="file-tree" size="small" aria-hidden="true" />;
    case "search":
      return <Icon name="magnifying-glass" size="small" aria-hidden="true" />;
    case "command":
      return <Icon name="terminal" size="small" aria-hidden="true" />;
    default:
      return <Icon name="outline-dots" size="small" aria-hidden="true" />;
  }
}
