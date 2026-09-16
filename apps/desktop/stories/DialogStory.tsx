import { useDialog } from "@opencode/ui/context/dialog";
import type { JSXElement } from "solid-js";
import { onCleanup, onMount } from "solid-js";

import { useServerFlowDismissBlock } from "../src/renderer/ui/ServerFlowDialogProvider.tsx";

type DialogStoryProps = {
  readonly children: (onDismissBlockedChange: (blocked: boolean) => void) => JSXElement;
};

export function DialogStory(props: DialogStoryProps) {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  let ownedDialog: typeof dialog.active;
  let disposed = false;
  const show = (): void => {
    setDismissBlocked(false);
    void dialog
      .show(() => props.children(setDismissBlocked))
      .then(() => {
        ownedDialog = dialog.active;
        if (disposed) ownedDialog?.dispose();
        return undefined;
      });
  };
  onMount(show);
  onCleanup(() => {
    disposed = true;
    ownedDialog?.dispose();
    setDismissBlocked(false);
  });
  return null;
}
