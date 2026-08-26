import type { JSX } from "solid-js";

export type UserMessageProps = {
  readonly id: string;
  readonly text: string;
};

export function UserMessage(props: UserMessageProps): JSX.Element {
  return (
    <article class="transcript-message transcript-user-message" data-message-id={props.id}>
      <div class="transcript-user-bubble">{props.text}</div>
    </article>
  );
}
