import { useDialog } from "@opencode-ai/ui/context/dialog";
import type { JSXElement } from "solid-js";
import { onCleanup, onMount } from "solid-js";

import { useServerFlowDismissBlock } from "../src/renderer/ui/ServerFlowDialogProvider.tsx";

type DialogStoryProps = {
  readonly children: (onDismissBlockedChange: (blocked: boolean) => void) => JSXElement;
};

function DialogStoryContent(props: DialogStoryProps) {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  const show = (): void => {
    setDismissBlocked(false);
    void dialog.show(() => props.children(setDismissBlocked));
  };
  onMount(show);
  onCleanup(() => {
    setDismissBlocked(false);
    if (dialog.active) dialog.close();
  });
  return null;
}

export function DialogStory(props: DialogStoryProps) {
  return <DialogStoryContent>{props.children}</DialogStoryContent>;
}
