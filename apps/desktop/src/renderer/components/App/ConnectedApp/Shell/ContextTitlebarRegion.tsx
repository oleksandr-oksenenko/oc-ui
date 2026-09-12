import { Show } from "solid-js";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";

import "../Changes/ContextPanel/ContextTabs.css";

export type ContextTitlebarRegionProps = {
  readonly browserAvailable?: boolean;
  readonly view?: "diff" | "browser";
  readonly onViewChange?: (view: "diff" | "browser") => void;
  readonly autoFocusClose?: boolean;
  readonly onClose?: () => void;
};

export function ContextTitlebarRegion(props: ContextTitlebarRegionProps) {
  return (
    <div class="context-tabs">
      <Show when={props.browserAvailable} fallback={<span class="context-tab-label">Diff</span>}>
        <div class="context-view-controls" role="group" aria-label="Workspace view">
          <button
            type="button"
            class="context-view-button oc-focus-inset"
            aria-pressed={props.view !== "browser"}
            onClick={() => props.onViewChange?.("diff")}
          >
            Diff
          </button>
          <button
            type="button"
            class="context-view-button oc-focus-inset"
            aria-pressed={props.view === "browser"}
            onClick={() => props.onViewChange?.("browser")}
          >
            Browser
          </button>
        </div>
      </Show>
      <IconButton
        class="context-panel-close"
        size="normal"
        variant="ghost"
        icon={<Icon name="layout-right-partial" size="small" aria-hidden="true" />}
        aria-label="Hide context panel"
        title="Hide context panel"
        autofocus={props.autoFocusClose}
        disabled={props.onClose === undefined}
        onClick={() => props.onClose?.()}
      />
    </div>
  );
}
