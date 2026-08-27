import { onCleanup, onMount } from "solid-js";

type ServerFlowDialogOptions = {
  readonly blocked: () => boolean;
  readonly onDismiss: () => void;
};

/** Owns the shared modal dismissal and focus-trap policy for server flow dialogs. */
export function createServerFlowDialog(options: ServerFlowDialogOptions) {
  let dialog: HTMLDialogElement | undefined;

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

    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
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

  onMount(() => {
    dialog?.addEventListener("cancel", handleCancel);
    dialog?.addEventListener("click", handleClick);
    dialog?.addEventListener("keydown", handleKeyDown);
    if (!dialog?.open) dialog?.showModal();
  });

  onCleanup(() => {
    dialog?.removeEventListener("cancel", handleCancel);
    dialog?.removeEventListener("click", handleClick);
    dialog?.removeEventListener("keydown", handleKeyDown);
    if (dialog?.open) dialog.close();
  });

  const ref = (element: HTMLDialogElement): void => {
    dialog = element;
  };

  return { ref, dismiss };
}
