import { useDialog } from "@opencode/ui/context/dialog";
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import { CodeReviewRemovalDialog } from "./ReviewRegion/CodeReviewRemovalDialog.tsx";

type ReviewRemovalRequest = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly focusTarget?: HTMLElement;
};

export type ReviewFlow = {
  readonly removal: Accessor<ReviewRemovalRequest | undefined>;
  readonly confirmRemoval: (request: ReviewRemovalRequest) => void;
  readonly dismissRemoval: () => void;
};

export function createReviewFlow(): ReviewFlow {
  const [removal, setRemoval] = createSignal<ReviewRemovalRequest>();
  return {
    removal,
    confirmRemoval: setRemoval,
    dismissRemoval: () => setRemoval(undefined),
  };
}

export type ReviewRegionProps = {
  readonly flow: ReviewFlow;
};

/** Owns code-review confirmation dialogs outside remountable diff annotations. */
export function ReviewRegion(props: ReviewRegionProps) {
  const dialog = useDialog();
  let activeDialog = dialog.active;
  let closing = false;

  onMount(() => {
    const request = props.flow.removal();
    if (!request) return;
    void dialog
      .show(
        () => (
          <CodeReviewRemovalDialog
            title={request.title}
            description={request.description}
            confirmLabel={request.confirmLabel}
            onConfirm={request.onConfirm}
          />
        ),
        () => {
          queueMicrotask(() => {
            if (closing) return;
            props.flow.dismissRemoval();
            restoreDialogFocusAfterClose(() => request.focusTarget);
          });
        },
      )
      .then(() => {
        activeDialog = dialog.active;
        if (closing && dialog.active === activeDialog) dialog.close();
        return undefined;
      });
  });

  onCleanup(() => {
    closing = true;
    if (dialog.active === activeDialog) dialog.close();
  });

  return null;
}
