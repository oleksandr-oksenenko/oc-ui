import { IconButton } from "@opencode/ui/icon-button";
import { Icon } from "@opencode/ui/icon";
import { Tooltip } from "@opencode/ui/tooltip";
import { useDialog } from "@opencode/ui/context/dialog";
import { Show, onCleanup, type JSX } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import type { GlobalFormsController } from "./createGlobalForms.ts";
import { ReviewDialog } from "./ReviewDialog.tsx";

import "./GlobalFormsRegion.css";

export type GlobalFormsRegionProps = {
  readonly controller: GlobalFormsController;
  readonly visible?: boolean;
  readonly onOpenExternal?: (url: string) => void;
};

export function GlobalFormsRegion(props: GlobalFormsRegionProps): JSX.Element {
  const dialog = useDialog();
  let launcher: HTMLButtonElement | undefined;
  let ownedDialogID: string | undefined;
  let openingDialog = false;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    if (ownedDialogID && dialog.active?.id === ownedDialogID) dialog.close();
  });

  const forms = () => props.controller.forms();
  const count = () => forms().length;
  const statusLabel = () => {
    if (props.controller.loadError()) {
      return count() === 0
        ? "Requests unavailable"
        : `${count()} request${count() === 1 ? "" : "s"} available; updates unavailable`;
    }
    if (!props.controller.connected()) {
      return count() === 0
        ? "Requests · Disconnected"
        : `${count()} cached request${count() === 1 ? "" : "s"} · Disconnected`;
    }
    if (props.controller.loading()) return "Loading requests";
    return count() === 0 ? "No requests" : `${count()} request${count() === 1 ? "" : "s"}`;
  };
  const launcherLabel = () => {
    if (props.controller.loadError()) {
      return count() === 0
        ? "Requests unavailable; open to retry"
        : `Review ${count()} request${count() === 1 ? "" : "s"}; updates unavailable; open to retry`;
    }
    if (!props.controller.connected()) {
      return `Review ${count()} cached request${count() === 1 ? "" : "s"}; disconnected`;
    }
    return `Review ${count()} request${count() === 1 ? "" : "s"}`;
  };
  const focusTarget = (): HTMLElement | undefined => {
    if (launcher?.isConnected) return launcher;
    return (
      document.querySelector<HTMLElement>(".shell-session-sidebar .shell-server-selector") ??
      document.querySelector<HTMLElement>('.shell-titlebar [aria-label="Show sessions"]') ??
      undefined
    );
  };
  const openReview = () => {
    if (openingDialog || (ownedDialogID && dialog.active?.id === ownedDialogID)) return;
    const first = forms()[0];
    openingDialog = true;
    void dialog
      .push(
        () => (
          <ReviewDialog
            controller={props.controller}
            onOpenExternal={props.onOpenExternal}
            initialFormID={first?.id}
          />
        ),
        () => {
          ownedDialogID = undefined;
          restoreDialogFocusAfterClose(focusTarget);
        },
      )
      .then(() => {
        openingDialog = false;
        ownedDialogID = dialog.active?.id;
        if (disposed && ownedDialogID) dialog.close();
        return undefined;
      });
  };

  return (
    <div class="global-forms-region-launcher">
      <Show when={count() > 0 || props.controller.loadError() !== undefined}>
        <Tooltip value={launcherLabel()} appearance="compact" inactive={props.visible === false}>
          <IconButton
            ref={(element: HTMLButtonElement) => {
              launcher = element;
            }}
            class="global-forms-region-button oc-focus-inset"
            data-error={props.controller.loadError() !== undefined ? true : undefined}
            type="button"
            size="large"
            variant="ghost-muted"
            aria-label={launcherLabel()}
            onClick={openReview}
            icon={
              <>
                <Icon
                  name={props.controller.loadError() ? "warning" : "notifications"}
                  size="small"
                  aria-hidden="true"
                />
                <span class="global-forms-region-count" aria-hidden="true">
                  {count() > 0 ? count() : "!"}
                </span>
              </>
            }
          />
        </Tooltip>
      </Show>
      <span class="sr-only" aria-live="polite">
        {statusLabel()}
      </span>
    </div>
  );
}
