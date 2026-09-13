import type { SessionInboxUser } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { For, Show, createMemo } from "solid-js";
import "./PendingMessages.css";

export function PendingMessages(props: {
  readonly messages: readonly SessionInboxUser[];
  readonly disabled?: boolean;
  readonly error?: string;
  readonly onRefresh?: () => void;
  readonly onCancel: (id: string) => void;
  readonly onSteer: (id: string) => void;
}) {
  const messages = createMemo(() => [
    ...props.messages.filter((message) => message.delivery === "steer"),
    ...props.messages.filter((message) => message.delivery === "queue"),
  ]);
  return (
    <Show when={props.messages.length > 0 || props.error}>
      <section class="pending-messages" aria-label="Pending messages">
        <Show when={props.error}>
          <div class="pending-error" role="alert">
            <span>{props.error}</span>
            <Button
              size="small"
              variant="ghost-muted"
              disabled={props.disabled}
              onClick={props.onRefresh}
            >
              Refresh
            </Button>
          </div>
        </Show>
        <ul>
          <For each={messages()}>
            {(message) => {
              const label = () =>
                message.payload.text ||
                message.payload.files?.map((file) => file.name ?? file.mime).join(", ") ||
                "Attached context";
              return (
                <li>
                  <div class="pending-message">
                    <span class="pending-label">
                      {message.delivery === "queue" ? "Queued" : "Steering · waiting for next step"}
                    </span>
                    <p title={label()}>{label()}</p>
                  </div>
                  <div class="pending-actions">
                    <Show when={message.delivery === "queue"}>
                      <Button
                        disabled={props.disabled}
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        onClick={() => props.onSteer(message.id)}
                      >
                        Steer now
                      </Button>
                    </Show>
                    <IconButton
                      disabled={props.disabled}
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      class="pending-remove"
                      aria-label={`Cancel message: ${label()}`}
                      title="Cancel message"
                      icon={<Icon name="close" size="small" aria-hidden="true" />}
                      onClick={() => props.onCancel(message.id)}
                    />
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}
