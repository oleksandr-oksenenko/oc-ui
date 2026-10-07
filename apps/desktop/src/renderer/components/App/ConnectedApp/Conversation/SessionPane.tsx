import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Button } from "@opencode/ui/button";

import "./SessionPane/SessionPane.css";

export type SessionPaneProps = {
  readonly selected?: boolean;
  readonly title?: string;
  readonly transcript?: JSX.Element;
  readonly composer?: JSX.Element;
  readonly noSelection?: JSX.Element;
  readonly canCreate?: boolean;
  readonly onCreate?: () => void;
  readonly onBrowseSessions?: () => void;
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
              <Show when={props.onCreate || props.onBrowseSessions}>
                <div class="session-pane-empty-actions">
                  <Show when={props.onCreate}>
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      disabled={!props.canCreate}
                      onClick={props.onCreate}
                    >
                      New session
                    </Button>
                  </Show>
                  <Show when={props.onBrowseSessions}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      onClick={props.onBrowseSessions}
                    >
                      Browse sessions
                    </Button>
                  </Show>
                </div>
              </Show>
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
