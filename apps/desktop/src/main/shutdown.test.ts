import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { createAppQuitHandler, settleSettingsIpc } from "./shutdown.ts";

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const setup = (needsConfirmation = true) => {
  const local = {
    needsQuitConfirmation: vi.fn<() => boolean>(() => needsConfirmation),
    shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const showMessageBox = vi
    .fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>()
    .mockResolvedValue({ response: 1, checkboxChecked: false });
  const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const quit = vi.fn<() => void>();
  const handler = createAppQuitHandler({
    localOpenCode: Effect.succeed({
      needsQuitConfirmation: Effect.sync(local.needsQuitConfirmation),
      shutdown: Effect.promise(local.shutdown),
    }),
    showMessageBox,
    cleanup: Effect.promise(cleanup),
    quit,
  });
  const event = { preventDefault: vi.fn<() => void>() };
  return { local, showMessageBox, cleanup, quit, handler, event };
};

describe("app quit", () => {
  it("can quit before services exist and releases the runtime from outside its scope", async () => {
    const disposed = vi.fn<() => void>();
    const runtime = ManagedRuntime.make(
      Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(disposed))),
    );
    await runtime.runPromise(Effect.void);
    const quit = vi.fn<() => void>();
    const handler = createAppQuitHandler({
      localOpenCode: Effect.void,
      showMessageBox: vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(),
      cleanup: runtime.disposeEffect,
      quit,
    });
    handler.beforeQuit({ preventDefault: vi.fn<() => void>() });
    await flush();
    expect(disposed).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("keeps admission closed until the native dialog settles and permits retry if it fails", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    const answer = deferred<MessageBoxReturnValue>();
    showMessageBox.mockReturnValueOnce(answer.promise);
    handler.beforeQuit(event);
    await flush();
    handler.beforeQuit(event);
    expect(handler.isQuitting()).toBe(true);
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(local.shutdown).not.toHaveBeenCalled();
    answer.resolve({ response: 0, checkboxChecked: false });
    await flush();
    expect(handler.isQuitting()).toBe(false);

    showMessageBox.mockRejectedValue(new Error("dialog unavailable"));
    handler.beforeQuit(event);
    await flush();
    expect(handler.isQuitting()).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
    handler.beforeQuit(event);
    await flush();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("shuts Settings down before waiting for accepted IPC and waits for both", async () => {
    const stopped = deferred<void>();
    const request = deferred<void>();
    let collectedIpc = false;
    let finished = false;
    const pendingIpc = {
      *[Symbol.iterator]() {
        collectedIpc = true;
        yield request.promise;
      },
    };
    const cleanup = Effect.runPromise(
      settleSettingsIpc(
        Effect.promise(() => stopped.promise),
        pendingIpc,
      ),
    ).then(() => {
      finished = true;
      return undefined;
    });
    await flush();
    expect(collectedIpc).toBe(false);
    stopped.resolve();
    await flush();
    expect(collectedIpc).toBe(true);
    expect(finished).toBe(false);
    request.resolve();
    await cleanup;
    expect(finished).toBe(true);
  });

  it("reports cleanup failure separately from failure to stop the server", async () => {
    const { handler, event, cleanup, showMessageBox, quit } = setup(false);
    cleanup.mockRejectedValueOnce(new Error("cleanup failed"));
    handler.beforeQuit(event);
    await flush();
    expect(showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Ocui could not finish closing." }),
    );
    expect(quit).not.toHaveBeenCalled();
    handler.beforeQuit(event);
    await flush();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("asks immediately for an owned starting runtime and Cancel leaves it intact", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
    handler.beforeQuit(event);

    expect(handler.isQuitting()).toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith({
      type: "warning",
      message: "Quit Ocui and stop built-in OpenCode?",
      detail: "Any work it is doing will be interrupted.",
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    expect(local.shutdown).not.toHaveBeenCalled();
    await flush();
    expect(handler.isQuitting()).toBe(false);
    expect(local.shutdown).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it("coalesces repeated Quit and waits for child shutdown before tearing down IPC", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    const stopped = deferred<void>();
    local.shutdown.mockReturnValue(stopped.promise);
    handler.beforeQuit(event);
    handler.beforeQuit(event);
    await flush();
    handler.beforeQuit(event);
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(local.shutdown).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();

    stopped.resolve();
    await flush();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    const finalEvent = { preventDefault: vi.fn<() => void>() };
    handler.beforeQuit(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("skips confirmation when no runtime has started but still closes the service", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup(false);
    handler.beforeQuit(event);
    await flush();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(local.shutdown).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("preserves app services on stop failure and lets a later Quit retry the same child", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    local.shutdown.mockRejectedValueOnce(new Error("stop failed"));
    handler.beforeQuit(event);
    await flush();

    expect(showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "error",
        message: "Built-in OpenCode could not be stopped.",
        detail: "Ocui is still open; try Quit again.",
      }),
    );
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(handler.isQuitting()).toBe(false);

    handler.beforeQuit(event);
    await flush();
    expect(local.shutdown).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("does not re-enter app.quit until final cleanup has settled", async () => {
    const { handler, event, cleanup, quit } = setup(false);
    const cleaned = deferred<void>();
    cleanup.mockReturnValue(cleaned.promise);
    handler.beforeQuit(event);
    await flush();
    expect(quit).not.toHaveBeenCalled();
    cleaned.resolve();
    await flush();
    expect(quit).toHaveBeenCalledOnce();
  });
});
