import type { SessionMessageAssistant } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { For, Show, type JSX } from "solid-js";

import { annotationBlock } from "../../annotation-source.ts";
import type { ServerFileImageReader } from "../../../../../../opencode/file-images.ts";
import type { ServerFileDownload } from "../../../../../../opencode/file-downloads.ts";

import { Markdown } from "./AssistantMessage/Markdown.tsx";
import { ActivityBlock } from "./AssistantMessage/ActivityBlock.tsx";
import type { ActivityContinuation, ActivityDetailInfo } from "./workDetailProjection.ts";
import type { GeneratedImage } from "./generatedImages.ts";
import { ImagePreview } from "../../../../../../ui/ImagePreview.tsx";

export type AssistantMessageProps = {
  readonly message: SessionMessageAssistant;
  readonly sessionID?: string;
  readonly sessionStatus: DataSessionStatus;
  readonly connected?: boolean;
  readonly turnActive?: boolean;
  readonly activityLive?: boolean;
  readonly activityOpen?: Map<string, boolean>;
  readonly workDetails?: readonly ActivityDetailInfo[];
  readonly continuations?: readonly ActivityContinuation[];
  readonly chainedTo?: string;
  /** Resolves `file:` images in Markdown through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
  readonly downloadFile?: ServerFileDownload;
  readonly directory?: string;
  readonly generatedImages?: readonly GeneratedImage[];
  readonly resolveAttachment?: (index: number, reference: string) => GeneratedImage | undefined;
};

export function AssistantMessage(props: AssistantMessageProps): JSX.Element {
  const error = () => props.message.error ?? props.message.retry?.error;
  const failed = () => error() !== undefined || props.message.finish === "error";
  const retrying = () =>
    props.message.retry !== undefined &&
    props.connected !== false &&
    props.sessionStatus === "running" &&
    (props.turnActive ?? true);
  const disconnected = () => props.message.retry !== undefined && props.connected === false;
  const status = () => {
    if (disconnected()) return "Disconnected";
    if (retrying()) return `Retrying, attempt ${props.message.retry?.attempt}`;
    const cause = error();
    if (cause?.type === "provider.internal" || cause?.status === 503) return "Provider unavailable";
    return cause ? `Failed: ${cause.message}` : "Failed";
  };
  const state = () =>
    retrying()
      ? "retrying"
      : failed()
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
      hidden={
        props.chainedTo !== undefined &&
        !props.generatedImages?.length &&
        !failed() &&
        !props.message.content.some((part) => part.type === "text")
      }
    >
      <div class="transcript-assistant-document">
        <For each={props.message.content}>
          {(content, index) => renderContent(content, index, props)}
        </For>
        <For each={props.generatedImages?.map((image) => image.reference)}>
          {(reference) => {
            const image = () =>
              props.generatedImages?.find((candidate) => candidate.reference === reference);
            return (
              <div class="transcript-generated-image-fallback">
                <Show when={image()?.src} fallback={<span>Generated image unavailable</span>}>
                  {(src) => (
                    <ImagePreview
                      src={src()}
                      fullSrc={image()?.fullSrc}
                      alt="Generated image"
                      class="transcript-generated-image"
                    />
                  )}
                </Show>
              </div>
            );
          }}
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
            live={props.activityLive === true}
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
            role={retrying() || disconnected() ? "status" : "alert"}
            data-annotation-block={annotationBlock("error")}
          >
            {status()}
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
          resolveAttachment={(reference) => props.resolveAttachment?.(index(), reference)}
          downloadFile={props.downloadFile}
        />
      );
    case "reasoning":
    case "tool":
      return (
        <Show
          when={
            (index() === 0 && props.chainedTo === undefined) ||
            props.message.content[index() - 1]?.type === "text"
          }
        >
          <ActivityBlock
            content={props.message.content}
            start={index()}
            messageCompleted={
              props.message.time.completed !== undefined ||
              props.message.finish !== undefined ||
              props.message.error !== undefined
            }
            workDetails={
              props.message.content.slice(index()).some((part) => part.type === "text")
                ? undefined
                : props.workDetails
            }
            continuations={
              props.message.content.slice(index()).some((part) => part.type === "text")
                ? undefined
                : props.continuations
            }
            active={props.turnActive === true}
            live={props.activityLive === true}
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
