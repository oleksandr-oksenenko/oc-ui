import type { SessionInfo } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show } from "solid-js";

export type SessionSidebarProps = {
  readonly sessions: readonly SessionInfo[];
  readonly selectedID?: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly canCreate: boolean;
  readonly creating: boolean;
  readonly status: (sessionID: string) => "idle" | "running";
  readonly onSelect: (sessionID: string) => void;
  readonly onCreate: () => void;
  readonly onRetry: () => void;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function SessionSidebar(props: SessionSidebarProps) {
  return (
    <aside class="session-sidebar" aria-label="Sessions">
      <div class="sidebar-header">
        <div>
          <p class="eyebrow">Sessions</p>
          <h2>Recent work</h2>
        </div>
        <Button
          type="button"
          size="small"
          variant={props.creating ? "loading" : "outline"}
          disabled={!props.canCreate || props.creating}
          onClick={props.onCreate}
        >
          New Session
        </Button>
      </div>

      <Show when={props.error}>
        {(error) => (
          <div class="sidebar-message" role="alert">
            <p>{error()}</p>
            <Button type="button" size="small" variant="outline" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        )}
      </Show>

      <Show when={props.loading && props.sessions.length === 0}>
        <div class="sidebar-message loading-message">
          <Loader aria-label="Loading sessions" />
          <span>Loading sessions</span>
        </div>
      </Show>

      <Show when={!props.loading && !props.error && props.sessions.length === 0}>
        <div class="sidebar-message">
          <p>No sessions in this directory yet.</p>
        </div>
      </Show>

      <nav class="session-list" aria-label="Recent sessions">
        <For each={props.sessions}>
          {(session) => (
            <button
              class="session-row"
              classList={{ selected: props.selectedID === session.id }}
              type="button"
              aria-current={props.selectedID === session.id ? "page" : undefined}
              onClick={() => props.onSelect(session.id)}
            >
              <span class="session-title">{session.title?.trim() || "Untitled session"}</span>
              <span class="session-meta">
                <Show when={props.status(session.id) === "running"}>
                  <span class="running-mark">Running</span>
                </Show>
                <time datetime={new Date(session.time.updated).toISOString()}>
                  {dateFormatter.format(session.time.updated)}
                </time>
              </span>
            </button>
          )}
        </For>
      </nav>
    </aside>
  );
}
