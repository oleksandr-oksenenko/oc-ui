import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Tabs } from "@opencode/ui/tabs";
import { createMemo, createUniqueId, For, Show, type JSX } from "solid-js";

import "./TerminalPanel.css";

export type TerminalPanelProps = {
  readonly open: boolean;
  readonly tabs: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly error?: string;
  }[];
  readonly activeID?: string;
  readonly creating?: boolean;
  readonly error?: string;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onReconnect: (id: string) => void;
  readonly onHide: () => void;
  /** All terminal surfaces; their owner controls selection without unmounting them. */
  readonly children?: JSX.Element;
};

const statusLabel = (status?: string) =>
  status === "connected" || status === "idle" ? undefined : status;

export function TerminalPanel(props: TerminalPanelProps): JSX.Element {
  const surfaces = props.children;
  const id = createUniqueId();
  const active = createMemo(() => props.tabs.find((tab) => tab.id === props.activeID));
  const error = () => props.error || active()?.error;
  const status = () => (props.creating ? "Creating terminal…" : statusLabel(active()?.status));

  return (
    <section class="terminal-panel" aria-label="Terminal" hidden={!props.open} inert={!props.open}>
      <Tabs
        class="terminal-panel-tabs"
        variant="panel"
        value={props.activeID}
        onChange={props.onSelect}
      >
        <div class="terminal-panel-tab-row">
          <Show when={props.tabs.length > 0}>
            {/* Close buttons are separate actions, not children of the ARIA tablist.
              Ownership keeps the upstream keyboard/list behavior and exposes only tabs. */}
            <div
              role="tablist"
              aria-label="Terminals"
              aria-orientation="horizontal"
              aria-owns={props.tabs.map((tab) => `${id}-${tab.id}`).join(" ")}
            />
            <Tabs.List
              class="terminal-panel-tab-list"
              role="toolbar"
              aria-label="Terminal tab actions"
            >
              <For each={props.tabs.map((tab) => tab.id)}>
                {(tabID) => {
                  const tab = () => props.tabs.find((entry) => entry.id === tabID);
                  return (
                    <Tabs.Trigger
                      value={tabID}
                      id={`${id}-${tabID}`}
                      aria-label={tab()?.title}
                      aria-describedby={
                        statusLabel(tab()?.status) ? `${id}-${tabID}-status` : undefined
                      }
                      data-status={tab()?.status}
                      aria-controls={`${id}-surfaces`}
                      class="terminal-panel-tab"
                      closeButton={
                        <Tabs.CloseButton
                          aria-label={`Close terminal ${tab()?.title}`}
                          title={`Close terminal ${tab()?.title}`}
                          onClick={() => props.onClose(tabID)}
                        />
                      }
                    >
                      <span class="terminal-panel-tab-title">{tab()?.title}</span>
                      <Show when={statusLabel(tab()?.status)}>
                        {(label) => (
                          <span class="terminal-panel-tab-status" id={`${id}-${tabID}-status`}>
                            {label()}
                          </span>
                        )}
                      </Show>
                    </Tabs.Trigger>
                  );
                }}
              </For>
            </Tabs.List>
          </Show>
          <div class="terminal-panel-actions">
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              icon={<Icon name="plus" />}
              aria-label="New terminal"
              data-terminal-focus
              title="New terminal"
              disabled={!props.canCreate || props.creating}
              onClick={props.onCreate}
            />
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              icon={<Icon name="chevron-down" />}
              aria-label="Hide terminal"
              title="Hide terminal"
              onClick={props.onHide}
            />
          </div>
        </div>
        <Show when={status()}>
          <div class="terminal-panel-status" role="status">
            <span>{status()}</span>
            <Show when={active()?.status === "failed"}>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  const tab = active();
                  if (tab) props.onReconnect(tab.id);
                }}
              >
                Reconnect terminal
              </Button>
            </Show>
            <Show when={active()?.status === "exited"}>
              <span>Process exited. Open a new terminal to continue.</span>
            </Show>
          </div>
        </Show>
        <Show when={error()}>
          {(message) => (
            <p class="terminal-panel-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div
          class="terminal-panel-surfaces"
          id={`${id}-surfaces`}
          role={active() ? "tabpanel" : undefined}
          aria-labelledby={active() ? `${id}-${active()!.id}` : undefined}
          tabIndex={active() ? 0 : undefined}
        >
          {surfaces}
          <Show when={props.tabs.length === 0 && !props.creating}>
            <div class="terminal-panel-empty">
              <p>No terminals open</p>
              <span>
                {props.canCreate
                  ? "Create a terminal with the + button."
                  : "Select a project to create a terminal."}
              </span>
            </div>
          </Show>
        </div>
      </Tabs>
    </section>
  );
}
