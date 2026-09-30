import { createEffect, onCleanup } from "solid-js";
import { useDialog } from "@opencode/ui/context/dialog";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { useServerFlowDismissBlock } from "../../../../ui/ServerFlowDialogProvider.tsx";
import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import type { WorkspaceModel } from "../createWorkspace.ts";
import { AddProjectDialog } from "./SessionSidebar/NewSessionFlow/AddProjectDialog.tsx";

export type AddProjectRegionProps = {
  readonly controller: WorkspaceModel["drafts"];
  readonly runtime: ConnectedRuntime;
};
export function AddProjectRegion(props: AddProjectRegionProps) {
  const dialog = useDialog();
  const blockDismiss = useServerFlowDismissBlock();
  let onClose: (() => void) | undefined;
  let disposed = false;
  createEffect(() => {
    const id = props.controller.current().addDraftID;
    if (!id) {
      if (onClose && dialog.active?.onClose === onClose) dialog.close();
      return;
    }
    if (onClose && dialog.active?.onClose === onClose) return;
    const initialLocation =
      props.controller.selected()?.value.choices.project?.location ?? props.runtime.defaultLocation;
    const close = () => {
      if (!disposed) {
        props.controller.dismissAddProject();
        restoreDialogFocusAfterClose(
          () =>
            document.querySelector<HTMLButtonElement>(
              '.new-session-setup button[aria-label^="Project:"]',
            ) ?? undefined,
        );
      }
    };
    onClose = close;
    void dialog
      .show(
        () => (
          <AddProjectDialog
            effects={props.runtime.effects}
            listDirectory={props.runtime.api.file.list}
            initialLocation={initialLocation}
            requestLocation={props.runtime.defaultLocation}
            adding={props.controller.current().adding}
            error={
              props.controller.current().addError
                ? { kind: "add-project", message: props.controller.current().addError! }
                : undefined
            }
            onDismissBlockedChange={blockDismiss}
            onAddProject={props.controller.addProject}
          />
        ),
        close,
      )
      .then(() => {
        if (disposed && dialog.active?.onClose === close) dialog.close();
        return undefined;
      });
  });
  onCleanup(() => {
    disposed = true;
    blockDismiss(false);
    if (onClose && dialog.active?.onClose === onClose) dialog.close();
  });
  return null;
}
