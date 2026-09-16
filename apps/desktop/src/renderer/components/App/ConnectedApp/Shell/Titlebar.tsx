import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { createEffect, onCleanup, type JSX } from "solid-js";

import "./Titlebar.css";

export type TitlebarProps = {
  readonly selectedTitle?: string;
  readonly globalControls?: JSX.Element;
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
  let focusGeneration = 0;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
  });

  const scheduleFocusRestore = (
    target: () => HTMLButtonElement | undefined,
    overlayOpen: () => boolean,
  ): void => {
    // Coalesce multiple closes in one update into a single restoration, and
    // let a newer restoration supersede an earlier one.
    const generation = ++focusGeneration;
    queueMicrotask(() => {
      if (disposed || generation !== focusGeneration) return;
      // The overlay reopened before the restoration ran; leave focus there.
      if (overlayOpen()) return;
      const active = document.activeElement;
      // Leave focus alone if the user moved it while the overlay was closing.
      if (active !== null && active !== document.body && active !== document.documentElement)
        return;
      const element = target();
      if (!element?.isConnected) return;
      // Avoid focus's scroll-into-view; focus still recalculates style.
      element.focus({ preventScroll: true });
    });
  };

  createEffect(() => {
    const leftOpen = props.leftSidebarOpen;
    const rightOpen = props.rightPanelOpen;
    if (props.mobile) {
      if (previousLeftOpen && !leftOpen)
        scheduleFocusRestore(
          () => leftToggle,
          () => props.leftSidebarOpen,
        );
      if (previousRightOpen && !rightOpen)
        scheduleFocusRestore(
          () => rightToggle,
          () => props.rightPanelOpen,
        );
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
          class="titlebar-icon-button oc-focus-inset"
          type="button"
          size="normal"
          variant="ghost-muted"
          icon={<Icon name="layout-left" />}
          aria-label={props.leftSidebarOpen ? "Hide sessions" : "Show sessions"}
          title={props.leftSidebarOpen ? "Hide sessions" : "Show sessions"}
          onClick={props.onToggleLeftSidebar}
        />
      </div>

      <div class="titlebar-center-region">
        <div class="titlebar-session" aria-live="polite">
          <span class="titlebar-session-title">
            {props.selectedTitle?.trim() || "No session selected"}
          </span>
        </div>
        <div class="titlebar-global-controls">{props.globalControls}</div>
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
                class="titlebar-icon-button oc-focus-inset"
                type="button"
                size="normal"
                variant="ghost-muted"
                icon={<Icon name="layout-right" />}
                aria-label="Show context"
                title="Show context"
                onClick={props.onToggleRightPanel}
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
