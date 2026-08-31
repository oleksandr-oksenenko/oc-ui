import { Show, createUniqueId, type JSX } from "solid-js";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Tabs } from "@opencode-ai/ui/tabs";

import "./ContextTabs.css";

export type ContextTabsProps = {
  readonly autoFocusClose?: boolean;
  readonly diffContent: JSX.Element;
  readonly idBase?: string;
  readonly onClose?: () => void;
  readonly showHeader?: boolean;
};

export function ContextTabs(props: ContextTabsProps) {
  const id = props.idBase ?? createUniqueId();
  const tabId = `workspace-context-${id}-tab-diff`;
  const panelId = `workspace-context-${id}-panel-diff`;

  return (
    <Tabs class="context-tabs-root" variant="panel" value="diff">
      <Show when={props.showHeader !== false}>
        <div class="context-tabs">
          <Tabs.List aria-label="Workspace context">
            <Tabs.Trigger
              value="diff"
              id={tabId}
              aria-controls={panelId}
              class="context-tab"
              classes={{ button: "context-tab-trigger" }}
            >
              Diff
            </Tabs.Trigger>
          </Tabs.List>
          <IconButton
            class="context-panel-close"
            size="normal"
            variant="ghost-muted"
            icon={<Icon name="layout-right-partial" size="small" aria-hidden="true" />}
            aria-label="Hide context panel"
            title="Hide context panel"
            autofocus={props.autoFocusClose}
            disabled={props.onClose === undefined}
            onClick={() => props.onClose?.()}
          />
        </div>
      </Show>
      <Tabs.Content
        value="diff"
        class="context-panel-tab-content"
        id={panelId}
        aria-label={props.showHeader === false ? "Diff" : undefined}
        aria-labelledby={props.showHeader === false ? undefined : tabId}
      >
        {props.diffContent}
      </Tabs.Content>
    </Tabs>
  );
}
