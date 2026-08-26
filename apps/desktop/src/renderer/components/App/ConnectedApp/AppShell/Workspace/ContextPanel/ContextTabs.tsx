import { For, Show, createUniqueId, type JSX } from "solid-js";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Tabs } from "@opencode-ai/ui/tabs";

import "../../SidebarToggleButton.css";
import "./ContextTabs.css";

export type ContextPanelTab = "diff" | "files";

export type ContextTabsProps = {
  readonly activeTab: ContextPanelTab;
  readonly autoFocusClose?: boolean;
  readonly diffContent?: JSX.Element;
  readonly filesContent?: JSX.Element;
  readonly idBase?: string;
  readonly onTabChange: (tab: ContextPanelTab) => void;
  readonly onClose?: () => void;
  readonly showHeader?: boolean;
};

const tabs: readonly { readonly id: ContextPanelTab; readonly label: string }[] = [
  { id: "diff", label: "Diff" },
  { id: "files", label: "Files" },
];

export function ContextTabs(props: ContextTabsProps) {
  const id = props.idBase ?? createUniqueId();
  const tabId = (tab: ContextPanelTab) => `workspace-context-${id}-tab-${tab}`;
  const panelId = (tab: ContextPanelTab) => `workspace-context-${id}-panel-${tab}`;

  return (
    <Tabs
      class="context-tabs-root"
      variant="panel"
      value={props.activeTab}
      onChange={(value) => {
        if (value === "diff" || value === "files") props.onTabChange(value);
      }}
    >
      <Show when={props.showHeader !== false}>
        <div class="context-tabs">
          <Tabs.List aria-label="Workspace context">
            <For each={tabs}>
              {(tab) => (
                <Tabs.Trigger
                  value={tab.id}
                  id={tabId(tab.id)}
                  aria-controls={panelId(tab.id)}
                  class="context-tab"
                  classes={{ button: "context-tab-trigger" }}
                >
                  {tab.label}
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
          <IconButton
            class="context-panel-close shell-sidebar-toggle-button"
            size="small"
            variant="ghost"
            icon={<Icon name="layout-right-partial" size="small" aria-hidden="true" />}
            aria-label="Hide context panel"
            title="Hide context panel"
            autofocus={props.autoFocusClose}
            disabled={props.onClose === undefined}
            onClick={() => props.onClose?.()}
          />
        </div>
      </Show>
      <Show when={props.diffContent !== undefined}>
        <div
          class="context-panel-tab-content"
          id={panelId("diff")}
          role="tabpanel"
          aria-label={props.showHeader === false && props.idBase === undefined ? "Diff" : undefined}
          aria-labelledby={
            props.showHeader === false && props.idBase === undefined ? undefined : tabId("diff")
          }
          hidden={props.activeTab !== "diff"}
        >
          {props.diffContent}
        </div>
      </Show>
      <Show when={props.filesContent !== undefined}>
        <div
          class="context-panel-tab-content"
          id={panelId("files")}
          role="tabpanel"
          aria-label={
            props.showHeader === false && props.idBase === undefined ? "Files" : undefined
          }
          aria-labelledby={
            props.showHeader === false && props.idBase === undefined ? undefined : tabId("files")
          }
          hidden={props.activeTab !== "files"}
        >
          {props.filesContent}
        </div>
      </Show>
    </Tabs>
  );
}
