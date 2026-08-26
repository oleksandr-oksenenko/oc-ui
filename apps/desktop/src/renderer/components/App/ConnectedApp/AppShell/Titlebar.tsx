import { IconLayoutSidebarLeftExpand, IconLayoutSidebarRightExpand } from "@tabler/icons-solidjs";
import type { JSX } from "solid-js";

import "./Titlebar.css";

export type TitlebarProps = {
  readonly selectedTitle?: string;
  readonly leftControls?: JSX.Element;
  readonly rightControls?: JSX.Element;
  readonly leftSidebarOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly rightPanelAvailable: boolean;
  readonly onToggleLeftSidebar: () => void;
  readonly onToggleRightPanel: () => void;
};

export function Titlebar(props: TitlebarProps): JSX.Element {
  const rightLabel = () => (props.rightPanelOpen ? "Hide context" : "Show context");

  return (
    <header
      class="shell-titlebar"
      classList={{
        "left-sidebar-open": props.leftSidebarOpen,
        "right-panel-open": props.rightPanelOpen,
      }}
    >
      <div class="titlebar-left-region">
        {props.leftSidebarOpen ? (
          props.leftControls
        ) : (
          <button
            class="titlebar-icon-button"
            type="button"
            aria-label="Show sessions"
            title="Show sessions"
            onClick={props.onToggleLeftSidebar}
          >
            <IconLayoutSidebarLeftExpand size={16} stroke="1.8" aria-hidden="true" />
          </button>
        )}
      </div>

      <div class="titlebar-session" aria-live="polite">
        <span class="titlebar-session-title">
          {props.selectedTitle?.trim() || "No session selected"}
        </span>
      </div>

      <div class="titlebar-right-region">
        {props.rightPanelOpen ? (
          props.rightControls
        ) : (
          <div class="titlebar-actions">
            {props.rightPanelAvailable && (
              <button
                class="titlebar-icon-button"
                type="button"
                aria-label={rightLabel()}
                title={rightLabel()}
                onClick={props.onToggleRightPanel}
              >
                <IconLayoutSidebarRightExpand size={16} stroke="1.8" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
