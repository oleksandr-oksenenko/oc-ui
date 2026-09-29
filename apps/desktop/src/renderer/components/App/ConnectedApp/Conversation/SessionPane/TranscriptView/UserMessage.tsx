import type { JSX } from "solid-js";
import type { SessionMessageUser } from "@opencode/client";
import { For, Show, createMemo } from "solid-js";
import { unwrap } from "solid-js/store";

import { AnnotationCard } from "./UserMessage/AnnotationCard.tsx";
import { PromptInstruction } from "./UserMessage/PromptInstruction.tsx";
import { annotationBlock } from "../../annotation-source.ts";
import {
  AttachmentPills,
  AttachmentDetailPill,
  AttachmentFilePill,
  AttachmentImagePill,
} from "../../../../../../ui/AttachmentPills.tsx";
import { ReviewAttachmentDetails } from "../../../../../../ui/ReviewAttachmentDetails.tsx";
import { promptFileImageSource } from "../../../../../../ui/ImagePreview.tsx";
import { readBrowserAnnotationMetadata } from "../../../../../../opencode/browser-annotation-metadata.ts";
import { readSessionPromptMetadata } from "../../../../../../opencode/session-prompt.ts";

export type UserMessageProps = {
  readonly message: SessionMessageUser;
  readonly onOpenAnnotation?: (
    messageID: string,
    annotationID: string,
    opener: HTMLElement,
  ) => void;
};

type TranscriptAttachment =
  | { readonly kind: "image"; readonly name: string; readonly source: string }
  | { readonly kind: "file"; readonly name: string };

export function UserMessage(props: UserMessageProps): JSX.Element {
  const metadata = createMemo(() =>
    props.message.metadata === undefined ? undefined : unwrap(props.message.metadata),
  );
  const prompt = createMemo(() => readSessionPromptMetadata(metadata()));
  const browser = createMemo(() => {
    const value = readBrowserAnnotationMetadata(metadata());
    if (
      !value ||
      value.annotations.some((item) => {
        const file = props.message.files?.[item.fileIndex];
        return !file || promptFileImageSource(file) === undefined;
      })
    )
      return undefined;
    return value;
  });
  const instruction = createMemo(() => {
    const browserMetadata = browser();
    if (browserMetadata) return browserMetadata.instruction || undefined;
    const value = prompt();
    return value === undefined ? props.message.text : value.instruction || undefined;
  });
  const reviewComments = () => prompt()?.reviewComments ?? [];
  const annotations = () => prompt()?.annotations ?? [];
  const inlineSkills = createMemo(() => {
    const text = instruction() ?? "";
    let end = 0;
    return (props.message.skills ?? []).filter((skill) => {
      const mention = skill.mention;
      if (!mention || mention.start < end || text.slice(mention.start, mention.end) !== skill.name)
        return false;
      end = mention.end;
      return true;
    });
  });
  const attachments = createMemo(
    () =>
      props.message.files?.flatMap((file, index): TranscriptAttachment[] => {
        if (browser()?.annotations.some((item) => item.fileIndex === index)) return [];
        const source = promptFileImageSource(file);
        return source === undefined
          ? [{ kind: "file", name: file.name || "Attached file" }]
          : [{ kind: "image", name: file.name || "Attached image", source }];
      }) ?? [],
  );
  const hasAttachments = () =>
    reviewComments().length > 0 ||
    annotations().length > 0 ||
    browser() !== undefined ||
    attachments().length > 0;
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.message.id}>
      {(instruction() !== undefined || hasAttachments()) && (
        <div class="transcript-user-bubble">
          {instruction() !== undefined && (
            <div data-annotation-block={annotationBlock("user", "text")}>
              <PromptInstruction text={instruction()!} skills={inlineSkills()} />
            </div>
          )}
          {hasAttachments() && (
            <AttachmentPills class="transcript-user-attachments">
              <Show when={reviewComments().length > 0}>
                <AttachmentDetailPill
                  kind="review"
                  label={`Review · ${reviewComments().length}`}
                  title="Review comments"
                >
                  <ReviewAttachmentDetails comments={reviewComments()} />
                </AttachmentDetailPill>
              </Show>
              <Show when={annotations().length > 0}>
                <AnnotationCard
                  annotations={annotations()}
                  onOpen={
                    props.onOpenAnnotation
                      ? (id, opener) => props.onOpenAnnotation?.(props.message.id, id, opener)
                      : undefined
                  }
                />
              </Show>
              <Show when={browser()}>
                {(value) => (
                  <AttachmentDetailPill
                    kind="browser"
                    label={`Browser · ${value().annotations.length}`}
                    title="Browser annotations"
                  >
                    <For each={value().annotations}>
                      {(item) => (
                        <div class="attachment-detail-row">
                          <p class="attachment-pill-comment-body">
                            {item.number}. {item.body}
                          </p>
                          <div class="attachment-pill-source">
                            {item.title} · {item.url}
                          </div>
                          <div class="attachment-pill-source">
                            {item.selection.selector || item.mode}
                          </div>
                          <AttachmentImagePill
                            src={promptFileImageSource(props.message.files![item.fileIndex]!)!}
                            name={props.message.files![item.fileIndex]!.name || "Attached image"}
                            alt={`Browser annotation ${item.number}`}
                          />
                        </div>
                      )}
                    </For>
                  </AttachmentDetailPill>
                )}
              </Show>
              <For each={attachments()}>
                {(attachment, index) => (
                  <div
                    class="transcript-user-attachment"
                    data-annotation-block={annotationBlock("attachment", index())}
                  >
                    <Show
                      when={attachment.kind === "image" ? attachment : undefined}
                      fallback={<AttachmentFilePill name={attachment.name} />}
                    >
                      {(image) => (
                        <AttachmentImagePill
                          src={image().source}
                          alt={image().name}
                          name={image().name}
                          class="transcript-user-image"
                        />
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </AttachmentPills>
          )}
        </div>
      )}
    </article>
  );
}
