import { Cause, Exit } from "effect";

/** Browser cancellation acknowledges closure only after owned cleanup has settled. */
export const browserIpcResult = (exit: Exit.Exit<void, unknown>): void => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    throw Cause.squash(exit.cause);
  }
};
