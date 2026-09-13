import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Show } from "solid-js";

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
      <h1>Sessions</h1>
      <div class="shell-session-header-actions">
        <IconButton
          class="shell-create-session"
          type="button"
          size="normal"
          variant="contrast"
          aria-label="Create session"
          title="Create session"
          disabled={!props.canCreate}
          icon={<Icon name="plus" aria-hidden="true" />}
          onClick={props.onCreate}
        />
        <Show when={props.onHide}>
          {(onHide) => (
            <IconButton
              type="button"
              size="normal"
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
    </div>
  );
}
