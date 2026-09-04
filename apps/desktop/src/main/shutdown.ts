import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

import type { LocalOpenCodeService } from "./local-opencode.ts";

/** Owns one native quit attempt, including cancellation and a failed-stop retry. */
export function createAppQuitHandler(dependencies: {
  readonly localOpenCode: () =>
    | Pick<LocalOpenCodeService, "needsQuitConfirmation" | "shutdown">
    | undefined;
  readonly showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  readonly cleanup: () => Promise<void>;
  readonly quit: () => void;
}) {
  let quitting = false;
  let complete = false;

  const finish = async (): Promise<void> => {
    try {
      const local = dependencies.localOpenCode();
      if (local?.needsQuitConfirmation()) {
        const { response } = await dependencies.showMessageBox({
          type: "warning",
          message: "Quit Ocui and stop built-in OpenCode?",
          detail: "Any work it is doing will be interrupted.",
          buttons: ["Cancel", "Quit"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response !== 1) return;
      }
      await local?.shutdown();
      await dependencies.cleanup();
      complete = true;
      dependencies.quit();
    } catch {
      await dependencies
        .showMessageBox({
          type: "error",
          message: "Built-in OpenCode could not be stopped.",
          detail: "Ocui is still open; try Quit again.",
          buttons: ["OK"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .catch(() => undefined);
    } finally {
      if (!complete) quitting = false;
    }
  };

  return {
    isQuitting: (): boolean => quitting,
    beforeQuit: (event: { preventDefault(): void }): void => {
      if (complete) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      void finish();
    },
  };
}
