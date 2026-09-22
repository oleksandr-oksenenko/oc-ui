// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createNativeOperation } from "./operation.ts";

afterEach(() => vi.useRealTimers());

describe("native operation drain", () => {
  it("starts one budget on cancel and expires once", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const operation = createNativeOperation(new AbortController().signal, expired);
    operation.cancel();
    operation.cancel();
    expect(operation.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("drains without aborting and finish clears the budget", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const operation = createNativeOperation(new AbortController().signal, expired);
    operation.drain();
    operation.finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expired).not.toHaveBeenCalled();
    expect(operation.signal.aborted).toBe(false);
  });

  it("follows the parent signal", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const parent = new AbortController();
    const operation = createNativeOperation(parent.signal, expired);
    parent.abort();
    expect(operation.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does not start the budget for a dialog abort", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const operation = createNativeOperation(new AbortController().signal, expired);
    operation.abort();
    expect(operation.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expired).not.toHaveBeenCalled();
  });
});
