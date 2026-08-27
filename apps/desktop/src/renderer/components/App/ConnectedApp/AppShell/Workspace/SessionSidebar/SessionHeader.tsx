import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Loader } from "@opencode-ai/ui/loader";
import { Show } from "solid-js";

import "../../SidebarToggleButton.css";
import "./SessionHeader.css";

export type SessionHeaderProps = {
  readonly canCreate: boolean;
  readonly creating: boolean;
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
        aria-label={props.creating ? "Creating session" : "Create session"}
        title={props.creating ? "Creating session" : "Create session"}
        disabled={!props.canCreate || props.creating}
        onClick={props.onCreate}
      >
        <Show
          when={!props.creating}
          fallback={<Loader class="session-header-spin" width={16} height={16} />}
        >
          <Icon name="plus" />
        </Show>
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
