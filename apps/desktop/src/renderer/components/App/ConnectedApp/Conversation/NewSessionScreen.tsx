import { Show, type JSX } from "solid-js";
import { Loader } from "@opencode/ui/loader";
import { Icon } from "@opencode/ui/icon";
import { NewSessionSetup, type NewSessionSetupProps } from "./NewSessionScreen/NewSessionSetup.tsx";
import "./NewSessionScreen/NewSessionScreen.css";

export type NewSessionScreenProps = {
  readonly setup: NewSessionSetupProps;
  readonly composer: JSX.Element;
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
        <div class="new-session-compose-stack">
          <NewSessionSetup {...props.setup} disabled={props.setup.disabled || preparing()} />
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
                <span>{status().message}</span>
              </div>
            )}
          </Show>
          {props.composer}
        </div>
      </div>
    </section>
  );
}
