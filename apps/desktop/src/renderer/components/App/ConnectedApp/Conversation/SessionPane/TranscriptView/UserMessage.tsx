import type { JSX } from "solid-js";
import type { SessionMessageUser } from "@opencode-ai/client";
import { createMemo } from "solid-js";
import { unwrap } from "solid-js/store";

import { AnnotationCard } from "./UserMessage/AnnotationCard.tsx";
import { annotationBlock } from "../../annotation-source.ts";
import { CodeReviewCard } from "./UserMessage/CodeReviewCard.tsx";
import { readSessionPromptMetadata } from "../../../../../../opencode/session-prompt.ts";

export type UserMessageProps = {
  readonly message: SessionMessageUser;
  readonly onOpenAnnotation?: (
    messageID: string,
    annotationID: string,
    opener: HTMLElement,
  ) => void;
};

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
  const attachments = () => [
    ...(props.message.files?.flatMap((file) => (file.name ? [file.name] : [])) ?? []),
    ...(props.message.agents?.map((agent) => agent.name) ?? []),
    ...(props.message.skills?.map((skill) => skill.name) ?? []),
  ];
  const showBubble = () =>
    instruction() !== undefined || reviewComments().length > 0 || attachments().length > 0;
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.message.id}>
      {showBubble() && (
        <div class="transcript-user-bubble">
          {instruction() !== undefined && (
            <div data-annotation-block={annotationBlock("user", "text")}>{instruction()}</div>
          )}
          {reviewComments().length > 0 && <CodeReviewCard comments={reviewComments()} />}
          {attachments().length > 0 && (
            <ul class="transcript-user-attachments" aria-label="Attachments">
              {attachments().map((name, index) => (
                <li data-annotation-block={annotationBlock("attachment", index)}>{name}</li>
              ))}
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
