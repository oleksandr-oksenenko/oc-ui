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

const setup = () => {
  const local = {
    shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const showMessageBox = vi
    .fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>()
    .mockResolvedValue({ response: 0, checkboxChecked: false });
  const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const quit = vi.fn<() => void>();
  const quiesceBrowsers = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const handler = createAppQuitHandler({
    quiesceBrowsers: Effect.promise(quiesceBrowsers),
    localOpenCode: Effect.succeed({ shutdown: Effect.promise(local.shutdown) }),
    showMessageBox,
    cleanup: Effect.promise(cleanup),
    quit,
  });
  const event = { preventDefault: vi.fn<() => void>() };
  return { local, showMessageBox, cleanup, quit, handler, event, quiesceBrowsers };
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
      quiesceBrowsers: Effect.void,
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

  it("quiesces browsers, stops the built-in server, cleans up, and quits without asking", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit, quiesceBrowsers } = setup();
    const order: string[] = [];
    quiesceBrowsers.mockImplementation(async () => {
      order.push("browser");
    });
    local.shutdown.mockImplementation(async () => {
      order.push("stop");
    });
    cleanup.mockImplementation(async () => {
      order.push("cleanup");
    });
    quit.mockImplementation(() => {
      order.push("quit");
    });
    handler.beforeQuit(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(handler.isQuitting()).toBe(true);
    await flush();
    expect(order).toEqual(["browser", "stop", "cleanup", "quit"]);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it("coalesces Quit and awaits browser cleanup before stopping the server", async () => {
    const { handler, event, local, cleanup, quit, quiesceBrowsers } = setup();
    const browsers = deferred<void>();
    quiesceBrowsers.mockReturnValue(browsers.promise);
    handler.beforeQuit(event);
    handler.beforeQuit(event);
    await flush();
    expect(quiesceBrowsers).toHaveBeenCalledOnce();
    expect(local.shutdown).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    browsers.resolve();
    await flush();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("releases the browser pause after a failed Quit dialog and allows a retry", async () => {
    let paused = false;
    const answer = deferred<MessageBoxReturnValue>();
    const local = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("stop failed"))
      .mockResolvedValue(undefined);
    const quit = vi.fn<() => void>();
    const handler = createAppQuitHandler({
      quiesceBrowsers: Effect.acquireRelease(
        Effect.sync(() => {
          paused = true;
        }),
        () =>
          Effect.sync(() => {
            paused = false;
          }),
      ),
      localOpenCode: Effect.succeed({ shutdown: Effect.promise(local) }),
      showMessageBox: () => answer.promise,
      cleanup: Effect.void,
      quit,
    });
    const event = { preventDefault() {} };
    handler.beforeQuit(event);
    await flush();
    expect(paused).toBe(true);
    expect(handler.isQuitting()).toBe(true);
    answer.resolve({ response: 0, checkboxChecked: false });
    await flush();
    expect(paused).toBe(false);
    expect(handler.isQuitting()).toBe(false);
    handler.beforeQuit(event);
    await flush();
    expect(local).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledOnce();
    expect(paused).toBe(false);
  });

  it("reports browser cleanup failure without stopping the server or destroying the app", async () => {
    const { handler, event, local, cleanup, quit, quiesceBrowsers, showMessageBox } = setup();
    quiesceBrowsers.mockRejectedValueOnce(new Error("browser cleanup failed"));
    handler.beforeQuit(event);
    await flush();
    expect(local.shutdown).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Ocui could not finish closing.",
      }),
    );
    expect(handler.isQuitting()).toBe(false);
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
    const { handler, event, cleanup, showMessageBox, quit } = setup();
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

  it("coalesces repeated Quit and waits for child shutdown before tearing down IPC", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    const stopped = deferred<void>();
    local.shutdown.mockReturnValue(stopped.promise);
    handler.beforeQuit(event);
    handler.beforeQuit(event);
    await flush();
    handler.beforeQuit(event);
    expect(showMessageBox).not.toHaveBeenCalled();
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

  it("coalesces quit while an error dialog is pending and permits retry after the dialog fails", async () => {
    const { handler, event, local, showMessageBox, cleanup, quit } = setup();
    local.shutdown.mockRejectedValueOnce(new Error("stop failed"));
    const answer = deferred<MessageBoxReturnValue>();
    showMessageBox.mockReturnValueOnce(answer.promise);
    handler.beforeQuit(event);
    handler.beforeQuit(event);
    await flush();
    expect(handler.isQuitting()).toBe(true);
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(local.shutdown).toHaveBeenCalledOnce();
    answer.resolve({ response: 0, checkboxChecked: false });
    await flush();
    expect(handler.isQuitting()).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();

    // A rejected native dialog must release the attempt instead of wedging quit.
    local.shutdown.mockRejectedValueOnce(new Error("stop failed again"));
    showMessageBox.mockRejectedValueOnce(new Error("dialog unavailable"));
    handler.beforeQuit(event);
    handler.beforeQuit(event);
    await flush();
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(handler.isQuitting()).toBe(false);

    handler.beforeQuit(event);
    await flush();
    expect(local.shutdown).toHaveBeenCalledTimes(3);
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
    const { handler, event, cleanup, quit } = setup();
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
