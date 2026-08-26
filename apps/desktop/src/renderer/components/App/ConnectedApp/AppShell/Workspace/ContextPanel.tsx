import { Show } from "solid-js";

import { ContextTabs } from "./ContextPanel/ContextTabs.tsx";
import type { ContextPanelTab } from "./ContextPanel/ContextTabs.tsx";
import { DiffView } from "./ContextPanel/DiffView.tsx";
import type { DiffViewProps } from "./ContextPanel/DiffView.tsx";
import { FilesView } from "./ContextPanel/FilesView.tsx";
import type { FilesViewProps } from "./ContextPanel/FilesView.tsx";

import "./ContextPanel/ContextPanel.css";

export type ContextPanelProps = {
  readonly activeTab: ContextPanelTab;
  readonly onTabChange: (tab: ContextPanelTab) => void;
  readonly onClose?: () => void;
  readonly showTabs?: boolean;
  readonly diff: DiffViewProps;
  readonly files: FilesViewProps;
};

export function ContextPanel(props: ContextPanelProps) {
  return (
    <aside class="context-panel" aria-label="Workspace context panel">
      <Show when={props.showTabs !== false}>
        <ContextTabs
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
          onClose={props.onClose}
        />
      </Show>
      <div class="context-panel-body">
        <Show when={props.activeTab === "diff"}>
          <DiffView {...props.diff} />
        </Show>
        <Show when={props.activeTab === "files"}>
          <FilesView {...props.files} />
        </Show>
      </div>
    </aside>
  );
}
