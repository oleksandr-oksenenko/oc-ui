import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconFileText,
  IconLoader2,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-solidjs";
import { createSignal, Show, type JSX } from "solid-js";
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
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);
  const expandable = () => props.output !== undefined && props.output.length > 0;
  const statusLabel = () =>
    props.status === "done" ? "Done" : props.status === "failed" ? "Failed" : "Running";

  return (
    <section class={`transcript-tool-call transcript-tool-${props.status}`}>
      <button
        class="transcript-tool-header"
        type="button"
        aria-expanded={expandable() ? expanded() : undefined}
        disabled={!expandable()}
        onClick={() => {
          if (expandable()) setExpanded((current) => !current);
        }}
      >
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
            fallback={<IconLoader2 class="transcript-tool-loader" size={14} aria-label="Running" />}
          >
            {props.status === "done" ? (
              <IconCheck size={14} aria-hidden="true" />
            ) : (
              <IconAlertTriangle size={14} aria-hidden="true" />
            )}
          </Show>
          <span>{statusLabel()}</span>
        </span>
        <Show when={expandable()}>
          <IconChevronDown size={15} aria-hidden="true" />
        </Show>
      </button>
      <Show when={expandable() && expanded()}>
        <pre class="transcript-tool-output">{props.output}</pre>
      </Show>
    </section>
  );
}

function renderToolIcon(kind: ToolCallKind | undefined): JSX.Element {
  switch (kind) {
    case "read":
      return <IconFileText size={15} aria-hidden="true" />;
    case "search":
      return <IconSearch size={15} aria-hidden="true" />;
    case "command":
      return <IconTerminal2 size={15} aria-hidden="true" />;
    default:
      return <IconDots size={15} aria-hidden="true" />;
  }
}
