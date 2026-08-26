import { For } from "solid-js";
import { IconLayoutSidebarRightCollapse } from "@tabler/icons-solidjs";

import "../../SidebarToggleButton.css";
import "./ContextTabs.css";

export type ContextPanelTab = "diff" | "files";

export type ContextTabsProps = {
  readonly activeTab: ContextPanelTab;
  readonly autoFocusClose?: boolean;
  readonly onTabChange: (tab: ContextPanelTab) => void;
  readonly onClose?: () => void;
};

const tabs: readonly { readonly id: ContextPanelTab; readonly label: string }[] = [
  { id: "diff", label: "Diff" },
  { id: "files", label: "Files" },
];

export function ContextTabs(props: ContextTabsProps) {
  return (
    <div class="context-tabs" role="tablist" aria-label="Workspace context">
      <For each={tabs}>
        {(tab) => (
          <button
            class="context-tab"
            classList={{ active: props.activeTab === tab.id }}
            type="button"
            role="tab"
            aria-selected={props.activeTab === tab.id}
            tabIndex={props.activeTab === tab.id ? 0 : -1}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        )}
      </For>
      <button
        class="context-panel-close shell-sidebar-toggle-button"
        type="button"
        aria-label="Hide context panel"
        title="Hide context panel"
        autofocus={props.autoFocusClose}
        disabled={props.onClose === undefined}
        onClick={() => props.onClose?.()}
      >
        <IconLayoutSidebarRightCollapse size={15} stroke="1.8" aria-hidden="true" />
      </button>
    </div>
  );
}
