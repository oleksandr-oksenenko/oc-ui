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
  readonly tabsIdBase?: string;
  readonly autoFocusClose?: boolean;
  readonly diff?: DiffViewProps;
  readonly files?: FilesViewProps;
};

export function ContextPanel(props: ContextPanelProps) {
  const diffContent = () => (
    <div class="context-panel-body">
      <Show
        when={props.diff}
        fallback={
          <div class="context-state empty-state">
            <p>Diff unavailable</p>
            <span>OpenCode diff data is not connected yet.</span>
          </div>
        }
      >
        {(diff) => <DiffView {...diff()} />}
      </Show>
    </div>
  );

  const filesContent = () => (
    <div class="context-panel-body">
      <Show
        when={props.files}
        fallback={
          <div class="context-state empty-state">
            <p>Files unavailable</p>
            <span>OpenCode file data is not connected yet.</span>
          </div>
        }
      >
        {(files) => <FilesView {...files()} />}
      </Show>
    </div>
  );

  return (
    <aside class="context-panel" aria-label="Workspace context panel">
      <Show
        when={props.showTabs !== false}
        fallback={
          <Show when={props.activeTab === "diff"} fallback={filesContent()}>
            {diffContent()}
          </Show>
        }
      >
        <ContextTabs
          activeTab={props.activeTab}
          autoFocusClose={props.autoFocusClose}
          diffContent={diffContent()}
          filesContent={filesContent()}
          idBase={props.tabsIdBase}
          onTabChange={props.onTabChange}
          onClose={props.onClose}
        />
      </Show>
    </aside>
  );
}
