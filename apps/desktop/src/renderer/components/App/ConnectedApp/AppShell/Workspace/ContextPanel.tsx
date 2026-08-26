import { ScrollView } from "@opencode-ai/ui/scroll-view";

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
  readonly diff: DiffViewProps;
  readonly files: FilesViewProps;
};

export function ContextPanel(props: ContextPanelProps) {
  return (
    <aside class="context-panel" aria-label="Workspace context panel">
      <ContextTabs
        activeTab={props.activeTab}
        autoFocusClose={props.autoFocusClose}
        diffContent={
          <ScrollView class="context-panel-body" thumbVisibility="hover">
            <DiffView {...props.diff} />
          </ScrollView>
        }
        filesContent={
          <ScrollView class="context-panel-body" thumbVisibility="hover">
            <FilesView {...props.files} />
          </ScrollView>
        }
        idBase={props.tabsIdBase}
        onTabChange={props.onTabChange}
        onClose={props.onClose}
        showHeader={props.showTabs !== false}
      />
    </aside>
  );
}
