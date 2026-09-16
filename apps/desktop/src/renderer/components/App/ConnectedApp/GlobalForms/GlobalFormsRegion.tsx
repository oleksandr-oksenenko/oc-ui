import { Button } from "@opencode/ui/button";
import { useDialog } from "@opencode/ui/context/dialog";
import { createEffect, onCleanup, type JSX } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import type { GlobalFormsController } from "./createGlobalForms.ts";
import { ReviewDialog, type AnswerStore } from "./ReviewDialog.tsx";

import "./GlobalFormsRegion.css";

export type GlobalFormsRegionProps = {
  readonly controller: GlobalFormsController;
  readonly onOpenExternal?: (url: string) => void;
};

export function GlobalFormsRegion(props: GlobalFormsRegionProps): JSX.Element {
  const dialog = useDialog();
  const answers: AnswerStore = new Map();
  let launcher: HTMLButtonElement | undefined;
  let ownedDialogID: string | undefined;
  let openingDialog = false;
  let disposed = false;

  createEffect(() => {
    const ids = new Set(props.controller.forms().map((form) => form.id));
    for (const id of answers.keys()) if (!ids.has(id)) answers.delete(id);
  });
  onCleanup(() => {
    disposed = true;
    if (ownedDialogID && dialog.active?.id === ownedDialogID) dialog.close();
  });

  const forms = () => props.controller.forms();
  const statusLabel = () => {
    if (!props.controller.connected()) {
      const count = forms().length;
      return count === 0
        ? "Global forms · Disconnected"
        : `${count} cached global form${count === 1 ? "" : "s"} · Disconnected`;
    }
    if (props.controller.loading()) return "Loading global forms";
    if (props.controller.loadError()) return "Global forms unavailable";
    const count = forms().length;
    return count === 0 ? "No global forms" : `${count} global form${count === 1 ? "" : "s"}`;
  };
  const launcherLabel = () => {
    const directory = props.controller.location.directory;
    if (!props.controller.connected()) {
      return `Disconnected; inspect cached global forms for ${directory}`;
    }
    if (props.controller.loading()) return `Loading global forms for ${directory}`;
    if (props.controller.loadError()) return `Global forms unavailable for ${directory}`;
    return forms().length > 0 ? `Review ${statusLabel()} for ${directory}` : "Review global forms";
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
            answers={answers}
            onAnswerChange={(formID, answer) => answers.set(formID, answer)}
            onOpenExternal={props.onOpenExternal}
            initialFormID={first?.id}
          />
        ),
        () => {
          ownedDialogID = undefined;
          restoreDialogFocusAfterClose(() => launcher);
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
      <Button
        ref={(element: HTMLButtonElement) => {
          launcher = element;
        }}
        class="global-forms-region-button"
        type="button"
        variant="ghost-muted"
        icon="mcp"
        aria-label={launcherLabel()}
        onClick={openReview}
      >
        <span class="global-forms-region-button-label">{statusLabel()}</span>
        <span
          class="global-forms-region-button-location"
          title={props.controller.location.directory}
        >
          {props.controller.location.directory}
        </span>
      </Button>
      <span class="sr-only" aria-live="polite">
        {`${statusLabel()} at ${props.controller.location.directory}`}
      </span>
    </div>
  );
}
