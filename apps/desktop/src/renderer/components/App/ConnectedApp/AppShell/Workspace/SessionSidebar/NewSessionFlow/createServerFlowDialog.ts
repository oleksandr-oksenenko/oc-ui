import { onCleanup, onMount } from "solid-js";

type ServerFlowDialogOptions = {
  readonly blocked: () => boolean;
  readonly onDismiss: () => void;
};

/** Owns the shared modal dismissal and focus-trap policy for server flow dialogs. */
export function createServerFlowDialog(options: ServerFlowDialogOptions) {
  let dialog: HTMLDialogElement | undefined;
  let lastFocused: HTMLElement | undefined;
  let focusObserver: MutationObserver | undefined;

  const focusableElements = (): HTMLElement[] => {
    if (!dialog) return [];
    return [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hidden && element.getAttribute("aria-disabled") !== "true");
  };

  const canFocus = (element: HTMLElement | undefined): boolean =>
    element !== undefined &&
    dialog?.contains(element) === true &&
    !element.hidden &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true" &&
    element.getAttribute("tabindex") !== "-1";

  const recoverFocus = (): void => {
    if (!dialog) return;
    if (canFocus(lastFocused)) return;
    const target = focusableElements()[0] ?? dialog;
    target.focus();
  };

  const dismiss = (): void => {
    if (!options.blocked()) options.onDismiss();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab" || !dialog) return;

    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCancel = (event: Event): void => {
    event.preventDefault();
    dismiss();
  };

  const handleClick = (event: MouseEvent): void => {
    if (event.target === dialog) dismiss();
  };

  const handleFocusIn = (event: FocusEvent): void => {
    if (event.target instanceof HTMLElement && event.target !== dialog) {
      lastFocused = event.target;
    }
  };

  onMount(() => {
    if (!dialog) return;
    dialog.tabIndex = -1;
    dialog?.addEventListener("cancel", handleCancel);
    dialog?.addEventListener("click", handleClick);
    dialog?.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("focusin", handleFocusIn);
    focusObserver = new MutationObserver(() => {
      queueMicrotask(() => {
        if (!dialog) return;
        if (lastFocused) recoverFocus();
        else if (focusableElements().length === 0 && document.activeElement !== dialog)
          dialog.focus();
      });
    });
    focusObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ["disabled", "hidden", "aria-disabled", "tabindex"],
      childList: true,
      subtree: true,
    });
    if (!dialog?.open) dialog?.showModal();
  });

  onCleanup(() => {
    dialog?.removeEventListener("cancel", handleCancel);
    dialog?.removeEventListener("click", handleClick);
    dialog?.removeEventListener("keydown", handleKeyDown);
    dialog?.removeEventListener("focusin", handleFocusIn);
    focusObserver?.disconnect();
    focusObserver = undefined;
    if (dialog?.open) dialog.close();
  });

  const ref = (element: HTMLDialogElement): void => {
    dialog = element;
  };

  return { ref, dismiss };
}
