import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { Effect, type Fiber } from "effect";

import type { LocalOpenCode } from "./local-opencode.ts";

/** Cancel Settings jobs before waiting for IPC callers that depend on them. */
export const settleSettingsIpc = Effect.fn("Desktop.settleSettingsIpc")(function* (
  shutdownSettings: Effect.Effect<void>,
  pendingIpc: Iterable<Promise<unknown>>,
) {
  yield* shutdownSettings;
  yield* Effect.promise(() => Promise.allSettled(pendingIpc)).pipe(Effect.uninterruptible);
});

/** Owns the native quit fiber outside the runtime it must eventually dispose. */
export function createAppQuitHandler(dependencies: {
  readonly localOpenCode: Effect.Effect<Pick<LocalOpenCode["Service"], "shutdown"> | void>;
  readonly showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  readonly cleanup: Effect.Effect<void>;
  readonly quit: () => void;
}) {
  let attempt: Fiber.Fiber<unknown, unknown> | undefined;
  let complete = false;
  const showMessageBox = (options: MessageBoxOptions) =>
    Effect.tryPromise(() => dependencies.showMessageBox(options)).pipe(Effect.uninterruptible);

  const finish = Effect.gen(function* () {
    let serverStopped = false;
    yield* Effect.gen(function* () {
      const local = yield* dependencies.localOpenCode;
      if (local !== undefined) yield* local.shutdown;
      serverStopped = true;
      yield* dependencies.cleanup;
      complete = true;
      dependencies.quit();
    }).pipe(
      Effect.catchCause(() =>
        showMessageBox({
          type: "error",
          message: serverStopped
            ? "Ocui could not finish closing."
            : "Built-in OpenCode could not be stopped.",
          detail: serverStopped ? "Try Quit again." : "Ocui is still open; try Quit again.",
          buttons: ["OK"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }).pipe(Effect.ignore),
      ),
    );
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        attempt = undefined;
      }),
    ),
  );

  return {
    isQuitting: (): boolean => complete || attempt !== undefined,
    beforeQuit: (event: { preventDefault(): void }): void => {
      if (complete) return;
      event.preventDefault();
      if (attempt !== undefined) return;
      Effect.runFork(finish, {
        onFiberStart: (fiber) => {
          attempt = fiber;
        },
      });
    },
  };
}
