import { Show, type Accessor, type JSX } from "solid-js";

import { AppShell } from "./AppShell.tsx";
import { Titlebar } from "./Titlebar.tsx";
import { Workspace } from "./Workspace.tsx";
import type { createShellPanelState } from "./createShellPanelState.ts";

type ShellPanelState = ReturnType<typeof createShellPanelState>;

export type ShellRegionProps = {
  readonly panels: ShellPanelState;
  readonly selectedTitle: Accessor<string | undefined>;
  readonly globalControls?: JSX.Element;
  readonly rightControls?: JSX.Element;
  readonly sidebar?: JSX.Element;
  readonly main: JSX.Element;
  readonly context?: JSX.Element;
};

export function ShellRegion(props: ShellRegionProps): JSX.Element {
  // Slots are fixed for the lifetime of a mounted shell. Resolve them once so
  // the effective panel visibility below does not recreate live children, and
  // the titlebar and workspace share one definition of an open panel.
  const sidebar = props.sidebar;
  const main = props.main;
  const context = props.context;
  const leftSidebarOpen = () => props.panels.leftSidebarOpen() && sidebar != null;
  const rightPanelOpen = () => props.panels.rightPanelOpen() && context != null;

  return (
    <AppShell
      titlebar={
        <Titlebar
          selectedTitle={props.selectedTitle()}
          globalControls={props.globalControls}
          leftSidebarOpen={leftSidebarOpen()}
          rightPanelOpen={rightPanelOpen()}
          rightPanelAvailable
          rightControls={<Show when={!props.panels.mobile()}>{props.rightControls}</Show>}
          mobile={props.panels.mobile()}
          onToggleLeftSidebar={props.panels.toggleLeftSidebar}
          onToggleRightPanel={props.panels.toggleRightPanel}
        />
      }
      workspace={
        <Workspace
          leftSidebarOpen={leftSidebarOpen()}
          rightPanelOpen={rightPanelOpen()}
          mobile={props.panels.mobile()}
          sidebar={sidebar}
          main={main}
          context={context}
        />
      }
    />
  );
}
