import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { createSignal, For } from "solid-js";

import { ShellRegion } from "../../src/renderer/components/App/ConnectedApp/Shell/ShellRegion.tsx";
import { createShellPanelState } from "../../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import {
  TerminalPanel,
  type TerminalPanelProps,
} from "../../src/renderer/components/App/ConnectedApp/Terminal/TerminalPanel.tsx";

import "./TerminalPanelFixture.css";

export function TerminalPanelFixture(props: {
  readonly tabs?: TerminalPanelProps["tabs"];
  readonly canCreate?: boolean;
  readonly creating?: boolean;
  readonly error?: string;
}) {
  const panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const [open, setOpen] = createSignal(true);
  const [tabs, setTabs] = createSignal<TerminalPanelProps["tabs"]>(props.tabs ?? []);
  const [activeID, setActiveID] = createSignal(props.tabs?.[0]?.id);
  let toggle: HTMLButtonElement | undefined;
  let nextID = 3;

  const create = () => {
    const id = String(nextID++);
    setTabs((current) => [...current, { id, title: `Terminal ${id}`, status: "connected" }]);
    setActiveID(id);
  };
  const close = (id: string) => {
    const remaining = tabs().filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (activeID() === id) setActiveID(remaining[0]?.id);
  };

  return (
    <div class="terminal-panel-fixture">
      <ShellRegion
        panels={panels}
        selectedTitle={() => "Workspace migration"}
        terminalControls={
          <IconButton
            ref={(element) => {
              toggle = element;
            }}
            class="oc-focus-inset"
            variant="ghost-muted"
            icon={<Icon name="console" />}
            aria-label={open() ? "Hide terminal panel" : "Show terminal"}
            title={open() ? "Hide terminal panel" : "Show terminal"}
            onClick={() => setOpen((current) => !current)}
          />
        }
        sidebar={
          <aside class="terminal-fixture-sidebar" aria-label="Session list">
            <button
              autofocus
              class="oc-focus-inset"
              onClick={() => panels.setLeftSidebarOpen(false)}
            >
              Hide session list
            </button>
            <p>Workspace migration</p>
            <p>API contract review</p>
          </aside>
        }
        rightControls={
          <button class="oc-focus-inset" onClick={() => panels.setRightPanelOpen(false)}>
            Hide context
          </button>
        }
        main={
          <div class="terminal-fixture-chat">
            <h1>Workspace migration</h1>
            <p>Chat stays above the terminal.</p>
            <label>
              Message
              <input class="oc-focus-inset" />
            </label>
          </div>
        }
        context={
          <aside class="terminal-fixture-context" aria-label="Context files">
            <button
              autofocus
              class="oc-focus-inset"
              onClick={() => panels.setRightPanelOpen(false)}
            >
              Close context
            </button>
            <p>src/Workspace.tsx</p>
            <p>src/Workspace.css</p>
          </aside>
        }
        bottomOpen={open()}
        bottom={
          <TerminalPanel
            open={open()}
            tabs={tabs()}
            activeID={activeID()}
            canCreate={props.canCreate !== false}
            creating={props.creating}
            error={props.error}
            onCreate={create}
            onSelect={setActiveID}
            onClose={close}
            onReconnect={(id) =>
              setTabs((current) =>
                current.map((tab) =>
                  tab.id === id ? { ...tab, status: "connected", error: undefined } : tab,
                ),
              )
            }
            onHide={() => {
              setOpen(false);
              toggle?.focus({ preventScroll: true });
            }}
          >
            <For each={tabs().map((tab) => tab.id)}>
              {(id) => (
                <div
                  class="terminal-fixture-surface"
                  hidden={activeID() !== id}
                  inert={activeID() !== id}
                  data-terminal-id={id}
                >
                  <pre>alex@homie:~/projects/oc-ui $</pre>
                  <textarea
                    class="oc-focus-inset"
                    aria-label={`Terminal ${id} input`}
                    placeholder="Type a command (controlled fixture)"
                  />
                </div>
              )}
            </For>
          </TerminalPanel>
        }
      />
    </div>
  );
}
