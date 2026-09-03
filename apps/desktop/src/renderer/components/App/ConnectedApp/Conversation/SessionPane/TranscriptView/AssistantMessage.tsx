import type { SessionMessageAssistant } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { For, Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";

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
        <For each={props.message.content}>{(content, index) => renderContent(content, index)}</For>
        <Show when={failed()}>
          <p
            class="transcript-message-failure"
            role="alert"
            data-annotation-block={annotationBlock("error")}
          >
            {props.message.error?.message ?? "Response failed"}
          </p>
        </Show>
      </div>
    </article>
  );
}

function renderContent(
  content: SessionMessageAssistant["content"][number],
  index: () => number,
): JSX.Element {
  switch (content.type) {
    case "text":
      return (
        <Markdown
          text={content.text}
          annotationBlock={annotationBlock("content", index(), "text")}
        />
      );
    case "reasoning":
      return (
        <ReasoningBlock
          reasoning={content}
          annotationBlock={annotationBlock("content", index(), "reasoning")}
        />
      );
    case "tool":
      return <ToolCall tool={content} />;
    default: {
      const unreachable: never = content;
      return unreachable;
    }
  }
}
