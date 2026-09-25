import { Icon } from "@opencode/ui/icon";
import { createSignal, type JSXElement } from "solid-js";

import { AppShell } from "../../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";

import "./global-forms.css";

type GlobalFormsShellProps = {
  readonly children: JSXElement;
  readonly selectedTitle?: string;
  readonly sidebarControls?: (visible: () => boolean) => JSXElement;
  readonly initialLeftSidebarOpen?: boolean;
};

export function GlobalFormsShell(props: GlobalFormsShellProps) {
  const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(props.initialLeftSidebarOpen ?? true);

  return (
    <div class="global-forms-fixture">
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle={props.selectedTitle ?? "Review MCP requests"}
            leftSidebarOpen={leftSidebarOpen()}
            rightPanelOpen={false}
            rightPanelAvailable={false}
            onToggleLeftSidebar={() => setLeftSidebarOpen((open) => !open)}
            onToggleRightPanel={() => undefined}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen={leftSidebarOpen()}
            rightPanelOpen={false}
            sidebar={
              <nav class="global-forms-sidebar" aria-label="Sessions">
                <div class="global-forms-sidebar-heading">
                  <Icon name="workspace" aria-hidden="true" />
                  <span>Workspace</span>
                </div>
                <ul class="global-forms-sidebar-list">
                  <li class="global-forms-sidebar-item">
                    <Icon name="terminal" aria-hidden="true" />
                    <span>Terminal</span>
                  </li>
                </ul>
                <div class="global-forms-sidebar-footer">
                  {props.sidebarControls?.(leftSidebarOpen)}
                  <button type="button" class="global-forms-sidebar-server">
                    Local server
                  </button>
                </div>
              </nav>
            }
            main={<div class="global-forms-main">{props.children}</div>}
          />
        }
      />
    </div>
  );
}
