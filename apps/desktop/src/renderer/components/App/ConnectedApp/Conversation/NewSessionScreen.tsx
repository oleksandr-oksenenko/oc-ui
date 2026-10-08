import { Show, type JSX } from "solid-js";
import { Loader } from "../../../../ui/Loader.tsx";
import { Icon } from "@opencode/ui/icon";
import { Button } from "@opencode/ui/button";
import { NewSessionSetup, type NewSessionSetupProps } from "./NewSessionScreen/NewSessionSetup.tsx";
import "./NewSessionScreen/NewSessionScreen.css";

export type NewSessionScreenProps = {
  readonly setup: NewSessionSetupProps;
  readonly composer: JSX.Element;
  readonly onRetry?: () => void;
  readonly status?: {
    readonly kind: "preparing" | "error" | "interrupted";
    readonly message: string;
  };
};

/** Controlled starting screen. Its owner supplies every draft and operation state. */
export function NewSessionScreen(props: NewSessionScreenProps) {
  const preparing = () => props.status?.kind === "preparing";
  return (
    <section class="new-session-screen" aria-label="New session" aria-busy={preparing()}>
      <div class="new-session-center">
        <Show when={props.status}>
          {(status) => (
            <div
              class="new-session-operation"
              data-kind={status().kind}
              role={status().kind === "error" ? "alert" : "status"}
            >
              <Show when={preparing()} fallback={<Icon name="warning" size="small" />}>
                <Loader width={14} height={14} />
              </Show>
              <span class="new-session-operation-message">{status().message}</span>
              <Show when={props.onRetry}>
                <Button type="button" size="small" variant="outline" onClick={props.onRetry}>
                  Retry
                </Button>
              </Show>
            </div>
          )}
        </Show>
        <div class="new-session-compose-stack">
          <NewSessionSetup {...props.setup} disabled={props.setup.disabled || preparing()} />
          {props.composer}
        </div>
      </div>
    </section>
  );
}
