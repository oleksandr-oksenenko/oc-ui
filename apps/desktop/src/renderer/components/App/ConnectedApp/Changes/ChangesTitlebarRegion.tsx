import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";

import "../../../../ui/SidebarToggleButton.css";
import "./ContextPanel/ContextTabs.css";

export type ChangesTitlebarRegionProps = {
  readonly onClose?: () => void;
};

export function ChangesTitlebarRegion(props: ChangesTitlebarRegionProps) {
  return (
    <div class="context-tabs">
      <span class="context-tab-label">Diff</span>
      <IconButton
        class="context-panel-close shell-sidebar-toggle-button"
        size="normal"
        variant="ghost"
        icon={<Icon name="layout-right-partial" size="small" aria-hidden="true" />}
        aria-label="Hide context panel"
        title="Hide context panel"
        disabled={props.onClose === undefined}
        onClick={() => props.onClose?.()}
      />
    </div>
  );
}
