import { Button } from "@opencode-ai/ui/button";
import { Show } from "solid-js";

export type ConnectionBarProps = {
  readonly serverUrl: string;
  readonly status: "connected" | "reconnecting";
  readonly attempt: number;
  readonly onChangeServer: () => void;
};

export function ConnectionBar(props: ConnectionBarProps) {
  return (
    <header class="connection-bar">
      <div class="server-identity">
        <span class="server-url">{props.serverUrl}</span>
        <span classList={{ "status-pill": true, reconnecting: props.status === "reconnecting" }}>
          <span class="status-dot" aria-hidden="true" />
          <Show when={props.status === "reconnecting"} fallback="Connected">
            Reconnecting{props.attempt > 0 ? ` · attempt ${props.attempt}` : ""}
          </Show>
        </span>
      </div>
      <Button type="button" size="small" variant="ghost" onClick={props.onChangeServer}>
        Change server
      </Button>
    </header>
  );
}
