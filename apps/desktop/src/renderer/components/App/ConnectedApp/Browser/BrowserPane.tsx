/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable browser status and error content needs keyboard access. */
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import type { Browser } from "@opencode/plugin-browser/rpc";
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import type { SessionBrowserState } from "./createSessionBrowser.ts";
import "./BrowserPane.css";

export type BrowserPaneProps = {
  readonly sessionSelected: boolean;
  readonly state: SessionBrowserState;
  readonly onReconnect: () => void;
  readonly onCommand: (action: Browser.Action) => void;
  readonly viewport?: JSX.Element;
  readonly annotation?: JSX.Element;
};

export function BrowserPane(props: BrowserPaneProps) {
  const tab = () =>
    props.state.browser.tabs.find((item) => item.id === props.state.browser.focusedTabID);
  const [address, setAddress] = createSignal("");
  const tabID = createMemo(() => tab()?.id);
  const committedUrl = createMemo(() => tab()?.url ?? "");
  // Drafts belong to this pane, not a tab cache. Switching tabs or committing a
  // different URL (even during editing) shows the actual location. Other browser
  // updates must leave the draft and its DOM selection alone.
  createEffect(on([tabID, committedUrl], ([, url]) => setAddress(url)));
  const navigate = (event: SubmitEvent) => {
    event.preventDefault();
    const current = tab();
    if (current) props.onCommand({ type: "navigate", tabID: current.id, url: address() });
    else props.onCommand({ type: "tabs.open", url: address() });
  };
  return (
    <section class="browser-pane" aria-label="Session browser">
      <Show
        when={props.state.status === "connected"}
        fallback={
          <div class="browser-empty oc-focus-inset" tabIndex={0}>
            <strong>Session browser</strong>
            <p>
              {props.sessionSelected
                ? "Browse and test pages together with the agent. Traffic uses the connected server, including its localhost."
                : "Select a session to use its browser."}
            </p>
            <Show when={props.sessionSelected}>
              <Show
                when={props.state.status === "failed" || props.state.status === "replaced"}
                fallback={
                  <p role="status">
                    {props.state.status === "unsupported"
                      ? "This server does not support the browser."
                      : "Connecting browser…"}
                  </p>
                }
              >
                <Button onClick={props.onReconnect}>Reconnect browser</Button>
              </Show>
            </Show>
          </div>
        }
      >
        <div class="browser-controls">
          <div class="browser-tabs" role="group" aria-label="Browser tabs">
            <div class="browser-tab-list">
              <For each={props.state.browser.tabs}>
                {(item) => (
                  <div
                    class="browser-tab"
                    classList={{ selected: item.id === props.state.browser.focusedTabID }}
                  >
                    <button
                      class="browser-tab-select oc-focus-inset"
                      type="button"
                      aria-pressed={item.id === props.state.browser.focusedTabID}
                      title={item.url}
                      onClick={() => props.onCommand({ type: "tabs.focus", tabID: item.id })}
                    >
                      {item.title || "New tab"}
                    </button>
                    <IconButton
                      size="normal"
                      variant="ghost-muted"
                      icon={<Icon name="close" size="small" />}
                      aria-label={`Close ${item.title || "new tab"}`}
                      title={`Close ${item.title || "new tab"}`}
                      onClick={() => props.onCommand({ type: "tabs.close", tabID: item.id })}
                    />
                  </div>
                )}
              </For>
            </div>
            <IconButton
              size="normal"
              variant="ghost-muted"
              icon={<Icon name="plus" size="small" />}
              aria-label="New browser tab"
              title="New browser tab"
              onClick={() => props.onCommand({ type: "tabs.open" })}
            />
          </div>
          <form class="browser-navigation" onSubmit={navigate}>
            <IconButton
              type="button"
              size="normal"
              variant="ghost-muted"
              icon={<Icon name="arrow-left" size="small" />}
              aria-label="Browser back"
              title="Browser back"
              disabled={!tab()?.canGoBack}
              onClick={() => {
                const item = tab();
                if (item) props.onCommand({ type: "back", tabID: item.id });
              }}
            />
            <IconButton
              type="button"
              size="normal"
              variant="ghost-muted"
              icon={<Icon name="arrow-right" size="small" />}
              aria-label="Browser forward"
              title="Browser forward"
              disabled={!tab()?.canGoForward}
              onClick={() => {
                const item = tab();
                if (item) props.onCommand({ type: "forward", tabID: item.id });
              }}
            />
            <Button
              class="browser-reload oc-focus-inset"
              type="button"
              size="small"
              variant="ghost-muted"
              disabled={!tab()}
              aria-label={tab()?.loading ? "Stop loading browser page" : "Reload browser page"}
              onClick={() => {
                const item = tab();
                if (item)
                  props.onCommand({ type: item.loading ? "stop" : "reload", tabID: item.id });
              }}
            >
              {tab()?.loading ? "Stop" : "Reload"}
            </Button>
            <input
              aria-label="Browser address"
              placeholder="Enter a URL"
              value={address()}
              onInput={(event) => setAddress(event.currentTarget.value)}
              spellcheck={false}
            />
            <Button type="submit" size="small">
              Go
            </Button>
          </form>
          {props.annotation}
        </div>
        <Show
          when={tab()}
          fallback={
            <div class="browser-empty oc-focus-inset" tabIndex={0}>
              <p>No tabs open.</p>
              <Button onClick={() => props.onCommand({ type: "tabs.open" })}>New tab</Button>
            </div>
          }
        >
          {props.viewport}
        </Show>
        <footer class="browser-status">
          <span>Browser connected</span>
        </footer>
      </Show>
      <Show when={props.state.error}>
        <p class="browser-error oc-focus-inset" role="alert" tabIndex={0}>
          {props.state.error}
        </p>
      </Show>
    </section>
  );
}
