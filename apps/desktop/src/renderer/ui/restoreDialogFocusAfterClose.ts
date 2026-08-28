const dialogCloseDurationMs = 100;

function canRestoreFocus(element: HTMLElement | undefined): element is HTMLElement {
  return (
    element !== undefined &&
    element.isConnected &&
    !element.hidden &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true"
  );
}

/** Restores focus after the OpenCode dialog provider removes its closing portal. */
export function restoreDialogFocusAfterClose(
  target: () => HTMLElement | undefined,
  shouldRestore: () => boolean = () => true,
): void {
  window.setTimeout(() => {
    const element = target();
    if (shouldRestore() && canRestoreFocus(element)) element.focus({ preventScroll: true });
  }, dialogCloseDurationMs + 10);
}
