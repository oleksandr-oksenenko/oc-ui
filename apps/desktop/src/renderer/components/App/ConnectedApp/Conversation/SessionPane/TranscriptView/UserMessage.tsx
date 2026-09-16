import type { JSX } from "solid-js";
import type { SessionMessageUser } from "@opencode/client";
import { For, Show, createMemo } from "solid-js";
import { unwrap } from "solid-js/store";

import { AnnotationCard } from "./UserMessage/AnnotationCard.tsx";
import { annotationBlock } from "../../annotation-source.ts";
import { CodeReviewCard } from "./UserMessage/CodeReviewCard.tsx";
import { ImagePreview, promptFileImageSource } from "../../../../../../ui/ImagePreview.tsx";
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
  | { readonly kind: "file"; readonly name: string }
  | { readonly kind: "name"; readonly name: string };

export function UserMessage(props: UserMessageProps): JSX.Element {
  const prompt = createMemo(() =>
    readSessionPromptMetadata(
      props.message.metadata === undefined ? undefined : unwrap(props.message.metadata),
    ),
  );
  const instruction = createMemo(() => {
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
  const instructionContent = () => {
    const text = instruction() ?? "";
    const parts: JSX.Element[] = [];
    let end = 0;
    for (const skill of inlineSkills()) {
      const mention = skill.mention!;
      parts.push(
        text.slice(end, mention.start),
        <span class="transcript-skill-chip">{skill.name}</span>,
      );
      end = mention.end;
    }
    parts.push(text.slice(end));
    return parts;
  };
  const attachments = (): TranscriptAttachment[] => [
    ...(props.message.files?.map((file): TranscriptAttachment => {
      const source = promptFileImageSource(file);
      return source === undefined
        ? { kind: "file", name: file.name || "Attached file" }
        : { kind: "image", name: file.name || "Attached image", source };
    }) ?? []),
    ...(props.message.agents?.map((agent): TranscriptAttachment => ({
      kind: "name",
      name: agent.name,
    })) ?? []),
    ...(props.message.skills
      ?.filter((skill) => !inlineSkills().includes(skill))
      .map((skill): TranscriptAttachment => ({ kind: "name", name: skill.name })) ?? []),
  ];
  const showBubble = () =>
    instruction() !== undefined || reviewComments().length > 0 || attachments().length > 0;
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.message.id}>
      {showBubble() && (
        <div class="transcript-user-bubble">
          {instruction() !== undefined && (
            <div data-annotation-block={annotationBlock("user", "text")}>
              {instructionContent()}
            </div>
          )}
          {reviewComments().length > 0 && <CodeReviewCard comments={reviewComments()} />}
          {attachments().length > 0 && (
            <ul class="transcript-user-attachments" aria-label="Attachments">
              <For each={attachments()}>
                {(attachment, index) => (
                  <li
                    class={attachment.kind === "image" ? "transcript-user-attachment-image" : ""}
                    data-annotation-block={annotationBlock("attachment", index())}
                  >
                    <Show
                      when={attachment.kind === "image" ? attachment : undefined}
                      fallback={attachment.name}
                    >
                      {(image) => (
                        <ImagePreview
                          src={image().source}
                          alt={image().name}
                          class="transcript-user-image"
                        />
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          )}
        </div>
      )}
      {annotations().length > 0 && (
        <AnnotationCard
          annotations={annotations()}
          onOpen={
            props.onOpenAnnotation
              ? (id, opener) => props.onOpenAnnotation?.(props.message.id, id, opener)
              : undefined
          }
        />
      )}
    </article>
  );
}
