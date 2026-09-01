import type { JSX } from "solid-js";
import type { SessionMessageUser } from "@opencode-ai/client";
import { createMemo } from "solid-js";
import { unwrap } from "solid-js/store";

import { CodeReviewCard } from "./UserMessage/CodeReviewCard.tsx";
import { readCodeReviewMetadata } from "../../../../../../opencode/code-review.ts";

export type UserMessageProps = {
  readonly message: SessionMessageUser;
};

export function UserMessage(props: UserMessageProps): JSX.Element {
  const review = createMemo(() =>
    readCodeReviewMetadata(
      props.message.metadata === undefined ? undefined : unwrap(props.message.metadata),
    ),
  );
  const attachments = () => [
    ...(props.message.files?.flatMap((file) => (file.name ? [file.name] : [])) ?? []),
    ...(props.message.agents?.map((agent) => agent.name) ?? []),
    ...(props.message.skills?.map((skill) => skill.name) ?? []),
  ];
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.message.id}>
      <div class="transcript-user-bubble">
        {(review()?.instruction || review() === undefined) && (
          <div>{review()?.instruction ?? props.message.text}</div>
        )}
        {review() !== undefined && <CodeReviewCard review={review()!} />}
        {attachments().length > 0 && (
          <ul class="transcript-user-attachments" aria-label="Attachments">
            {attachments().map((name) => (
              <li>{name}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
