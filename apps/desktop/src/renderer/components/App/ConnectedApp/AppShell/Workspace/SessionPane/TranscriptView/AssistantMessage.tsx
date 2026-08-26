import type { JSX } from "solid-js";
import { For, Show } from "solid-js";

import { ReasoningBlock } from "./AssistantMessage/ReasoningBlock.tsx";
import { ToolCall } from "./AssistantMessage/ToolCall.tsx";
import type {
  AssistantBlock,
  AssistantTextBlock,
  TranscriptContent,
  TranscriptInline,
} from "../transcript-types.ts";

export type AssistantMessageProps = {
  readonly id: string;
  readonly blocks: readonly AssistantBlock[];
  readonly state: "streaming" | "complete" | "failed";
};

export function AssistantMessage(props: AssistantMessageProps): JSX.Element {
  return (
    <article
      class={`transcript-message transcript-assistant-message transcript-assistant-${props.state}`}
      data-message-id={props.id}
      data-state={props.state}
    >
      <div class="transcript-assistant-document">
        <For each={props.blocks}>{(block) => renderBlock(block)}</For>
        <Show when={props.state === "failed"}>
          <p class="transcript-message-failure" role="alert">
            Response failed
          </p>
        </Show>
      </div>
    </article>
  );
}

function renderBlock(block: AssistantBlock): JSX.Element {
  switch (block.kind) {
    case "paragraph":
      return <p class="transcript-paragraph">{renderContent(block.content)}</p>;
    case "heading":
      return renderHeading(block);
    case "list":
      return block.ordered ? (
        <ol class="transcript-list-block">
          <For each={block.items}>{(item) => <li>{renderContent(item)}</li>}</For>
        </ol>
      ) : (
        <ul class="transcript-list-block">
          <For each={block.items}>{(item) => <li>{renderContent(item)}</li>}</For>
        </ul>
      );
    case "quote":
      return <blockquote class="transcript-quote">{renderContent(block.content)}</blockquote>;
    case "reasoning":
      return (
        <ReasoningBlock
          summary={block.summary}
          label={block.label}
          duration={block.duration}
          defaultOpen={block.defaultOpen}
        />
      );
    case "tool":
      return (
        <ToolCall
          name={block.name}
          toolKind={block.toolKind}
          target={block.target}
          detail={block.detail}
          status={block.status}
          output={block.output}
          defaultExpanded={block.defaultExpanded}
        />
      );
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

function renderHeading(block: AssistantTextBlock & { readonly kind: "heading" }): JSX.Element {
  const level = block.level ?? 2;
  if (level === 1) return <h1 class="transcript-heading">{renderContent(block.content)}</h1>;
  if (level === 3) return <h3 class="transcript-heading">{renderContent(block.content)}</h3>;
  return <h2 class="transcript-heading">{renderContent(block.content)}</h2>;
}

function renderContent(content: TranscriptContent): JSX.Element {
  if (typeof content === "string") return <>{content}</>;
  if (!Array.isArray(content)) return renderInline(content as TranscriptInline);
  return (
    <>
      <For each={content}>{(part) => renderInline(part)}</For>
    </>
  );
}

function renderInline(part: TranscriptInline): JSX.Element {
  if (typeof part === "string") return <>{part}</>;
  if (part.kind === "link") {
    return (
      <a href={part.href} target="_blank" rel="noreferrer">
        {part.text}
      </a>
    );
  }
  return <>{part.text}</>;
}
