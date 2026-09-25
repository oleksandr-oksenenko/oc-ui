import type { SessionMessageAssistant } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { For, Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";
import type { ServerFileImageReader } from "../../../../../../opencode/file-images.ts";

import { Markdown } from "./AssistantMessage/Markdown.tsx";
import { ActivityBlock } from "./AssistantMessage/ActivityBlock.tsx";
import type { WorkDetailInfo } from "./WorkDetailMessage.tsx";

export type AssistantMessageProps = {
  readonly message: SessionMessageAssistant;
  readonly sessionID?: string;
  readonly sessionStatus: DataSessionStatus;
  readonly turnActive?: boolean;
  readonly activityOpen?: Map<string, boolean>;
  readonly workDetails?: readonly WorkDetailInfo[];
  /** Resolves `file:` images in Markdown through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
  readonly directory?: string;
};

export function AssistantMessage(props: AssistantMessageProps): JSX.Element {
  const failed = () => props.message.error !== undefined || props.message.finish === "error";
  const state = () =>
    failed()
      ? "failed"
      : props.message.time.completed === undefined &&
          (props.turnActive ?? props.sessionStatus === "running")
        ? "streaming"
        : "complete";

  return (
    <article
      class={`transcript-message transcript-assistant-message transcript-assistant-${state()}`}
      data-message-id={props.message.id}
      data-state={state()}
    >
      <div class="transcript-assistant-document">
        <For each={props.message.content}>
          {(content, index) => renderContent(content, index, props)}
        </For>
        <Show
          when={
            (props.workDetails?.length ?? 0) > 0 &&
            (props.message.content.at(-1)?.type === "text" || props.message.content.length === 0)
          }
        >
          <ActivityBlock
            content={[]}
            start={0}
            workDetails={props.workDetails}
            active={props.turnActive === true}
            disclosureKey={
              props.sessionID === undefined
                ? undefined
                : JSON.stringify([props.sessionID, props.message.id, "work-details"])
            }
            activityOpen={props.activityOpen}
            directory={props.directory}
          />
        </Show>
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
  props: AssistantMessageProps,
): JSX.Element {
  switch (content.type) {
    case "text":
      return (
        <Markdown
          text={content.text}
          annotationBlock={annotationBlock("content", index(), "text")}
          readFileImage={props.readFileImage}
        />
      );
    case "reasoning":
    case "tool":
      return (
        <Show when={index() === 0 || props.message.content[index() - 1]?.type === "text"}>
          <ActivityBlock
            content={props.message.content}
            start={index()}
            workDetails={
              props.message.content.slice(index()).some((part) => part.type === "text")
                ? undefined
                : props.workDetails
            }
            active={props.turnActive === true}
            disclosureKey={
              props.sessionID === undefined
                ? undefined
                : JSON.stringify([props.sessionID, props.message.id, index()])
            }
            activityOpen={props.activityOpen}
            directory={props.directory}
          />
        </Show>
      );
    default: {
      const unreachable: never = content;
      return unreachable;
    }
  }
}
