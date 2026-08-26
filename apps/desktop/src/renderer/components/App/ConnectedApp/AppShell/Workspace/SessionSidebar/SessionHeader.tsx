import { IconLayoutSidebarLeftCollapse, IconLoader2, IconPlus } from "@tabler/icons-solidjs";
import { Show } from "solid-js";

import "../../SidebarToggleButton.css";
import "./SessionHeader.css";

export type SessionHeaderProps = {
  readonly canCreate: boolean;
  readonly creating: boolean;
  readonly autoFocusClose?: boolean;
  readonly onCreate: () => void;
  readonly onHide: () => void;
};

export function SessionHeader(props: SessionHeaderProps) {
  return (
    <div class="shell-session-header">
      <button
        class="shell-create-session"
        type="button"
        aria-label={props.creating ? "Creating session" : "Create session"}
        title={props.creating ? "Creating session" : "Create session"}
        disabled={!props.canCreate || props.creating}
        onClick={props.onCreate}
      >
        <Show
          when={!props.creating}
          fallback={
            <IconLoader2 class="session-header-spin" size={16} stroke="1.8" aria-hidden="true" />
          }
        >
          <IconPlus size={16} stroke="1.8" aria-hidden="true" />
        </Show>
        <span>New Session</span>
      </button>
      <button
        class="shell-sidebar-toggle-button"
        type="button"
        aria-label="Hide sessions"
        title="Hide sessions"
        autofocus={props.autoFocusClose}
        onClick={props.onHide}
      >
        <IconLayoutSidebarLeftCollapse size={16} stroke="1.8" aria-hidden="true" />
      </button>
    </div>
  );
}
