import { DialogProvider } from "@opencode-ai/ui/context/dialog";
import {
  createContext,
  createSignal,
  onCleanup,
  type ParentProps,
  type Setter,
  useContext,
} from "solid-js";

const Context = createContext<Setter<boolean>>();

function stopDismissal(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Adds the server-flow dismissal rule around OpenCode's dialog provider. */
export function ServerFlowDialogProvider(props: ParentProps) {
  const [blocked, setBlocked] = createSignal(false);

  const keyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && blocked()) stopDismissal(event);
  };
  const backdrop = (event: Event): void => {
    if (!blocked()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-component="dialog-overlay"]')) {
      stopDismissal(event);
    }
  };

  window.addEventListener("keydown", keyDown, true);
  window.addEventListener("pointerdown", backdrop, true);
  window.addEventListener("click", backdrop, true);
  onCleanup(() => {
    window.removeEventListener("keydown", keyDown, true);
    window.removeEventListener("pointerdown", backdrop, true);
    window.removeEventListener("click", backdrop, true);
  });

  return (
    <Context.Provider value={setBlocked}>
      <DialogProvider>{props.children}</DialogProvider>
    </Context.Provider>
  );
}

export function useServerFlowDismissBlock(): Setter<boolean> {
  const setBlocked = useContext(Context);
  if (!setBlocked)
    throw new Error("useServerFlowDismissBlock must be used within ServerFlowDialogProvider");
  return setBlocked;
}
