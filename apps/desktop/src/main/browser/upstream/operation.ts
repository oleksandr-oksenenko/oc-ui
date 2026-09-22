/**
 * Owns one native browser operation whose external awaits cannot be cancelled
 * directly (Chromium's `sendCommand`). Cancellation aborts the operation and
 * starts a single drain budget; if the operation has not settled when the
 * budget expires, the owner retires the page instead of waiting forever.
 *
 * `abort` is for a JavaScript dialog, which abandons the action without
 * treating the page as terminal. `drain` starts the budget for a final cleanup
 * that must not run under an unbounded await. All methods are idempotent.
 */

export type NativeOperation = {
  readonly signal: AbortSignal;
  cancel: () => void;
  drain: () => void;
  abort: () => void;
  finish: () => void;
};

const DRAIN_TIMEOUT_MS = 10_000;

export function createNativeOperation(parent: AbortSignal, onExpired: () => void): NativeOperation {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const startDrain = () => {
    if (timer) return;
    timer = setTimeout(() => {
      if (expired) return;
      expired = true;
      controller.abort();
      onExpired();
    }, DRAIN_TIMEOUT_MS);
  };
  const cancel = () => {
    controller.abort();
    startDrain();
  };
  const onParentAbort = () => cancel();
  if (parent.aborted) onParentAbort();
  else parent.addEventListener("abort", onParentAbort, { once: true });
  return {
    signal: controller.signal,
    cancel,
    drain: startDrain,
    abort: () => controller.abort(),
    finish: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}
