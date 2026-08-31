import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { createEffect, type JSX } from "solid-js";

import "./Titlebar.css";

export type TitlebarProps = {
  readonly selectedTitle?: string;
  readonly rightControls?: JSX.Element;
  readonly leftSidebarOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly rightPanelAvailable: boolean;
  readonly mobile?: boolean;
  readonly onToggleLeftSidebar: () => void;
  readonly onToggleRightPanel: () => void;
};

export function Titlebar(props: TitlebarProps): JSX.Element {
  let leftToggle: HTMLButtonElement | undefined;
  let rightToggle: HTMLButtonElement | undefined;
  let previousLeftOpen = props.leftSidebarOpen;
  let previousRightOpen = props.rightPanelOpen;
  const rightLabel = () => (props.rightPanelOpen ? "Hide context" : "Show context");

  createEffect(() => {
    const leftOpen = props.leftSidebarOpen;
    const rightOpen = props.rightPanelOpen;
    if (props.mobile) {
      if (previousLeftOpen && !leftOpen) {
        queueMicrotask(() => leftToggle?.focus());
      }
      if (previousRightOpen && !rightOpen) {
        queueMicrotask(() => rightToggle?.focus());
      }
    }
    previousLeftOpen = leftOpen;
    previousRightOpen = rightOpen;
  });

  return (
    <header
      class="shell-titlebar"
      classList={{
        "left-sidebar-open": props.leftSidebarOpen,
        "right-panel-open": props.rightPanelOpen,
        mobile: props.mobile === true,
      }}
      aria-hidden={
        props.mobile && (props.leftSidebarOpen || props.rightPanelOpen) ? "true" : undefined
      }
      inert={props.mobile === true && (props.leftSidebarOpen || props.rightPanelOpen)}
    >
      <div class="titlebar-left-region">
        <IconButton
          ref={(element) => {
            leftToggle = element;
          }}
          class="titlebar-icon-button"
          type="button"
          size="normal"
          variant="ghost-muted"
          icon={<Icon name="layout-left" />}
          aria-label={props.leftSidebarOpen ? "Hide sessions" : "Show sessions"}
          title={props.leftSidebarOpen ? "Hide sessions" : "Show sessions"}
          onClick={props.onToggleLeftSidebar}
        />
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
              <IconButton
                ref={(element) => {
                  rightToggle = element;
                }}
                class="titlebar-icon-button"
                type="button"
                size="normal"
                variant="ghost-muted"
                icon={<Icon name="layout-right" />}
                aria-label={rightLabel()}
                title={rightLabel()}
                onClick={props.onToggleRightPanel}
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
