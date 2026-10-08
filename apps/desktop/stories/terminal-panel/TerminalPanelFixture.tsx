import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Button } from "@opencode/ui/button";
import { TextInput } from "@opencode/ui/text-input";
import { createSignal, For } from "solid-js";

import { ShellRegion } from "../../src/renderer/components/App/ConnectedApp/Shell/ShellRegion.tsx";
import { createShellPanelState } from "../../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import {
  TerminalPanel,
  type TerminalPanelProps,
} from "../../src/renderer/components/App/ConnectedApp/Terminal/TerminalPanel.tsx";

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
    <div style={{ height: "100vh" }}>
      <ShellRegion
        panels={panels}
        selectedTitle={() => "Workspace migration"}
        terminalControls={
          <IconButton
            ref={(element) => {
              toggle = element;
            }}
            variant="ghost-muted"
            icon={<Icon name="console" />}
            aria-label={open() ? "Hide terminal panel" : "Show terminal"}
            title={open() ? "Hide terminal panel" : "Show terminal"}
            onClick={() => setOpen((current) => !current)}
          />
        }
        sidebar={
          <Button autofocus onClick={() => panels.setLeftSidebarOpen(false)}>
            Hide session list
          </Button>
        }
        rightControls={
          <Button onClick={() => panels.setRightPanelOpen(false)}>Hide context</Button>
        }
        main={<TextInput aria-label="Message" />}
        context={
          <Button autofocus onClick={() => panels.setRightPanelOpen(false)}>
            Close context
          </Button>
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
                <div hidden={activeID() !== id} inert={activeID() !== id} data-terminal-id={id}>
                  <TextInput aria-label={`Terminal ${id} input`} />
                </div>
              )}
            </For>
          </TerminalPanel>
        }
      />
    </div>
  );
}
