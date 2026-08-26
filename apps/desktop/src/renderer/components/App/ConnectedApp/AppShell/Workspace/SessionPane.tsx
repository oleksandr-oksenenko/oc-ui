import type { JSX } from "solid-js";
import { Show } from "solid-js";

import "./SessionPane/SessionPane.css";

export type SessionPaneProps = {
  readonly selected?: boolean;
  readonly title?: string;
  readonly transcript?: JSX.Element;
  readonly composer?: JSX.Element;
  readonly noSelection?: JSX.Element;
};

export function SessionPane(props: SessionPaneProps): JSX.Element {
  return (
    <Show
      when={props.selected === true}
      fallback={
        <section class="session-pane-empty" aria-label="Session">
          {props.noSelection ?? (
            <>
              <h2>No session selected</h2>
              <p>Choose a session or create a new one to start a conversation.</p>
            </>
          )}
        </section>
      }
    >
      <section class="session-pane-shell" aria-label={props.title ?? "Session"}>
        <div class="session-pane-transcript">{props.transcript}</div>
        <div class="session-pane-composer">{props.composer}</div>
      </section>
    </Show>
  );
}
