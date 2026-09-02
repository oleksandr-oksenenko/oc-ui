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
  return (
    <AppShell
      titlebar={
        <Titlebar
          selectedTitle={props.selectedTitle()}
          globalControls={props.globalControls}
          leftSidebarOpen={props.panels.leftSidebarOpen()}
          rightPanelOpen={props.panels.rightPanelOpen()}
          rightPanelAvailable
          rightControls={<Show when={!props.panels.mobile()}>{props.rightControls}</Show>}
          mobile={props.panels.mobile()}
          onToggleLeftSidebar={props.panels.toggleLeftSidebar}
          onToggleRightPanel={props.panels.toggleRightPanel}
        />
      }
      workspace={
        <Workspace
          leftSidebarOpen={props.panels.leftSidebarOpen()}
          rightPanelOpen={props.panels.rightPanelOpen()}
          mobile={props.panels.mobile()}
          sidebar={props.sidebar}
          main={props.main}
          context={props.context}
        />
      }
    />
  );
}
