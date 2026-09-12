import { Show } from "solid-js";

import { ContextTabs } from "./ContextPanel/ContextTabs.tsx";
import { DiffView } from "./ContextPanel/DiffView.tsx";
import type { DiffViewProps } from "./ContextPanel/DiffView.tsx";

import "./ContextPanel/ContextPanel.css";

export type ContextPanelProps = {
  readonly onClose?: () => void;
  readonly showTabs?: boolean;
  readonly tabsIdBase?: string;
  readonly autoFocusClose?: boolean;
  readonly diff?: DiffViewProps;
};

export function ContextPanel(props: ContextPanelProps) {
  const diffContent = () => (
    <div class="context-panel-body oc-scrollable">
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

  return (
    <aside class="context-panel" aria-label="Workspace context panel">
      <Show when={props.showTabs !== false} fallback={diffContent()}>
        <ContextTabs
          autoFocusClose={props.autoFocusClose}
          diffContent={diffContent()}
          idBase={props.tabsIdBase}
          onClose={props.onClose}
        />
      </Show>
    </aside>
  );
}
