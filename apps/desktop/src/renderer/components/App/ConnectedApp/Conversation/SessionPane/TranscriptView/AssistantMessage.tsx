import type { SessionMessageAssistant } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { For, Show, type JSX } from "solid-js";

import { Markdown } from "./AssistantMessage/Markdown.tsx";
import { ReasoningBlock } from "./AssistantMessage/ReasoningBlock.tsx";
import { ToolCall } from "./AssistantMessage/ToolCall.tsx";

export type AssistantMessageProps = {
  readonly message: SessionMessageAssistant;
  readonly sessionStatus: DataSessionStatus;
};

export function AssistantMessage(props: AssistantMessageProps): JSX.Element {
  const failed = () => props.message.error !== undefined || props.message.finish === "error";
  const state = () =>
    failed()
      ? "failed"
      : props.message.time.completed === undefined && props.sessionStatus === "running"
        ? "streaming"
        : "complete";

  return (
    <article
      class={`transcript-message transcript-assistant-message transcript-assistant-${state()}`}
      data-message-id={props.message.id}
      data-state={state()}
    >
      <div class="transcript-assistant-document">
        <For each={props.message.content}>{(content) => renderContent(content)}</For>
        <Show when={failed()}>
          <p class="transcript-message-failure" role="alert">
            {props.message.error?.message ?? "Response failed"}
          </p>
        </Show>
      </div>
    </article>
  );
}

function renderContent(content: SessionMessageAssistant["content"][number]): JSX.Element {
  switch (content.type) {
    case "text":
      return <Markdown text={content.text} />;
    case "reasoning":
      return <ReasoningBlock reasoning={content} />;
    case "tool":
      return <ToolCall tool={content} />;
    default: {
      const unreachable: never = content;
      return unreachable;
    }
  }
}
