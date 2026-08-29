import type { JSX } from "solid-js";
import type { SessionMessageUser } from "@opencode-ai/client";

export type UserMessageProps = {
  readonly message: SessionMessageUser;
};

export function UserMessage(props: UserMessageProps): JSX.Element {
  const attachments = () => [
    ...(props.message.files?.flatMap((file) => (file.name ? [file.name] : [])) ?? []),
    ...(props.message.agents?.map((agent) => agent.name) ?? []),
    ...(props.message.skills?.map((skill) => skill.name) ?? []),
  ];
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.message.id}>
      <div class="transcript-user-bubble">
        <div>{props.message.text}</div>
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
