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
      <Collapsible.Trigger class="transcript-tool-header">
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
          <span class="sr-only">{statusLabel()}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div
          class="transcript-tool-details"
          data-annotation-disabled={
            status() === "streaming" || status() === "running" ? "true" : undefined
          }
        >
          <For each={details()}>{(detail) => detail}</For>
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}

function toolDetails(tool: SessionMessageAssistantTool): JSX.Element[] {
  switch (tool.state.status) {
    case "streaming":
      return [<pre class="transcript-tool-output oc-scrollable">{tool.state.input}</pre>];
    case "running":
    case "completed":
    case "error":
      return [
        <pre
          class="transcript-tool-output oc-scrollable"
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
      class="transcript-tool-output oc-scrollable"
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
      <Show
        when={
          content.mime.startsWith("image/") &&
          /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(content.uri)
        }
        fallback={
          <Show when={content.name}>
            <span
              class="transcript-tool-file-uri"
              data-annotation-block={annotationBlock("tool", toolID, "output", index, "uri")}
            >
              {content.uri}
            </span>
          </Show>
        }
      >
        <img
          class="transcript-tool-image"
          src={content.uri}
          alt={content.name ?? "Browser capture"}
          loading="lazy"
        />
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
    ? "open-file"
    : normalized.includes("search") || normalized.includes("grep") || normalized.includes("glob")
      ? "magnifying-glass"
      : normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")
        ? "pencil-line"
        : normalized.includes("shell") ||
            normalized.includes("command") ||
            normalized.includes("bash")
          ? "terminal"
          : "code";
  return <Icon name={icon} size="small" aria-hidden="true" />;
}
