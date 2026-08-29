import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Show } from "solid-js";

import "../../../../../ui/SidebarToggleButton.css";
import "./SessionHeader.css";

export type SessionHeaderProps = {
  readonly canCreate: boolean;
  readonly autoFocusClose?: boolean;
  readonly onCreate: () => void;
  readonly onHide?: () => void;
};

export function SessionHeader(props: SessionHeaderProps) {
  return (
    <div class="shell-session-header" classList={{ "has-close": props.onHide !== undefined }}>
      <Button
        class="shell-create-session"
        type="button"
        size="small"
        variant="ghost-muted"
        aria-label="Create session"
        title="Create session"
        disabled={!props.canCreate}
        onClick={props.onCreate}
      >
        <Icon name="plus" />
        <span>New Session</span>
      </Button>
      <Show when={props.onHide}>
        {(onHide) => (
          <IconButton
            class="shell-sidebar-toggle-button"
            type="button"
            size="small"
            variant="ghost-muted"
            icon={<Icon name="layout-left-partial" />}
            aria-label="Hide sessions"
            title="Hide sessions"
            autofocus={props.autoFocusClose}
            onClick={onHide()}
          />
        )}
      </Show>
    </div>
  );
}
