import type {
  SessionMessageAssistantTool,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageToolStateRunning,
  ToolContent,
} from "@opencode-ai/client";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, type JSX } from "solid-js";

import { annotationBlock } from "../../../annotation-source.ts";

export type ToolCallProps = {
  readonly tool: SessionMessageAssistantTool;
};

export function ToolCall(props: ToolCallProps): JSX.Element {
  const details = () => toolDetails(props.tool);
  const expandable = () => details().length > 0;
  const status = () => props.tool.state.status;
  const statusLabel = () =>
    status() === "completed"
      ? "Completed"
      : status() === "error"
        ? "Error"
        : status() === "streaming"
          ? "Streaming"
          : "Running";

  return (
    <Collapsible class={`transcript-tool-call transcript-tool-${status()}`} defaultOpen={false}>
      <Collapsible.Trigger class="transcript-tool-header" disabled={!expandable()}>
        {renderToolIcon(props.tool.name)}
        <span class="transcript-tool-copy">
          <span class="transcript-tool-name">{props.tool.name}</span>
        </span>
        <span class="transcript-tool-status">
          <Show
            when={status() === "completed" || status() === "error"}
            fallback={
              <Loader class="transcript-tool-loader" width={14} height={14} aria-hidden="true" />
            }
          >
            <Icon
              name={status() === "completed" ? "check" : "warning"}
              size="small"
              aria-hidden="true"
            />
          </Show>
          <span>{statusLabel()}</span>
        </span>
        <Show when={expandable()}>
          <Collapsible.Arrow />
        </Show>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Show when={expandable()}>
          <div
            class="transcript-tool-details"
            data-annotation-disabled={
              status() === "streaming" || status() === "running" ? "true" : undefined
            }
          >
            <For each={details()}>{(detail) => detail}</For>
          </div>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}

function toolDetails(tool: SessionMessageAssistantTool): JSX.Element[] {
  switch (tool.state.status) {
    case "streaming":
      return [<pre class="transcript-tool-output">{tool.state.input}</pre>];
    case "running":
    case "completed":
    case "error":
      return [
        <pre
          class="transcript-tool-output"
          data-annotation-block={annotationBlock("tool", tool.id, "input")}
        >
          {formatObject(tool.state)}
        </pre>,
        ...(tool.state.status === "running"
          ? []
          : (tool.state.content ?? []).map((content, index) =>
              renderToolContent(content, tool.id, index),
            )),
      ];
    default: {
      const unreachable: never = tool.state;
      return [unreachable];
    }
  }
}

function renderToolContent(content: ToolContent, toolID: string, index: number): JSX.Element {
  return content.type === "text" ? (
    <pre
      class="transcript-tool-output"
      data-annotation-block={annotationBlock("tool", toolID, "output", index, "text")}
    >
      {content.text}
    </pre>
  ) : (
    <div class="transcript-tool-file">
      <Icon name="file-tree" size="small" aria-hidden="true" />
      <span data-annotation-block={annotationBlock("tool", toolID, "output", index, "name")}>
        {content.name ?? content.uri}
      </span>
      <span
        data-annotation-block={annotationBlock("tool", toolID, "output", index, "mime")}
        class="transcript-tool-file-mime"
      >
        {content.mime}
      </span>
      <Show when={content.name}>
        <span
          data-annotation-block={annotationBlock("tool", toolID, "output", index, "uri")}
          class="transcript-tool-file-uri"
        >
          {content.uri}
        </span>
      </Show>
    </div>
  );
}

function formatObject(
  state:
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError,
): string {
  if (state.status === "error") {
    return JSON.stringify({ input: state.input, error: state.error }, null, 2);
  }
  return JSON.stringify(state.input, null, 2);
}

function renderToolIcon(name: string): JSX.Element {
  const normalized = name.toLowerCase();
  const icon = normalized.includes("read")
    ? "file-tree"
    : normalized.includes("search")
      ? "magnifying-glass"
      : normalized.includes("shell") ||
          normalized.includes("command") ||
          normalized.includes("bash")
        ? "terminal"
        : "outline-dots";
  return <Icon name={icon} size="small" aria-hidden="true" />;
}
