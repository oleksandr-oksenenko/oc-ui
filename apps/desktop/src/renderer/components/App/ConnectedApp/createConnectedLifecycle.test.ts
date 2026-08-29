import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createConnectedLifecycle } from "./createConnectedLifecycle.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(ready: Promise<void>) {
  const [status, setStatus] = createSignal<"connected" | "reconnecting">("connected");
  const [bootstrapped, setBootstrapped] = createSignal(false);
  const calls: string[] = [];
  const sessions = {
    syncCatalog: vi.fn<() => Promise<void>>(async () => {
      calls.push("catalog");
    }),
    beginRecovery: vi.fn<() => void>(() => {
      calls.push("begin-recovery");
    }),
    refreshAfterReconnect: vi.fn<() => Promise<void>>(async () => {
      calls.push("refresh-sessions");
    }),
    failRecovery: vi.fn<() => void>(() => {
      calls.push("fail-recovery");
    }),
  };
  const runtime = {
    ready,
    defaultLocation: { directory: "/workspace" },
    data: {
      location: {
        syncInfo: vi.fn<(location: { readonly directory: string }) => Promise<void>>(async () => {
          calls.push("location");
        }),
      },
    },
  };
  const syncModels = vi.fn<() => Promise<void>>(async () => {
    calls.push("models");
  });
  const onConnected = vi.fn<() => void>(() => {
    calls.push("connected");
  });
  const onInitialFailure = vi.fn<(cause: unknown) => void>();
  const markBootstrapped = vi.fn<() => void>(() => setBootstrapped(true));

  return {
    bootstrapped,
    markBootstrapped,
    connected: () => status() === "connected",
    calls,
    sessions,
    runtime,
    setStatus,
    syncModels,
    onConnected,
    onInitialFailure,
  };
}

describe("createConnectedLifecycle", () => {
  it("announces connection after location setup, then refreshes feature data", async () => {
    const fixture = setup(Promise.resolve());
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    expect(fixture.calls).toEqual(["location", "connected", "catalog", "models"]);
    expect(fixture.onInitialFailure).not.toHaveBeenCalled();
    dispose();
  });

  it("reports initial setup failure while mounted", async () => {
    const failure = new Error("offline");
    const fixture = setup(Promise.reject(failure));
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });

    await vi.waitFor(() => expect(fixture.onInitialFailure).toHaveBeenCalledWith(failure));
    expect(fixture.onConnected).not.toHaveBeenCalled();
    dispose();
  });

  it("does not publish setup results after its owner is disposed", async () => {
    const ready = deferred<void>();
    const fixture = setup(ready.promise);
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });

    dispose();
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.onConnected).not.toHaveBeenCalled();
    expect(fixture.onInitialFailure).not.toHaveBeenCalled();
  });

  it("waits for initial feature sync before refreshing after reconnect", async () => {
    const initialCatalog = deferred<void>();
    const fixture = setup(Promise.resolve());
    fixture.sessions.syncCatalog.mockImplementationOnce(async () => {
      fixture.calls.push("catalog");
      await initialCatalog.promise;
    });
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");
    await Promise.resolve();

    expect(fixture.sessions.refreshAfterReconnect).not.toHaveBeenCalled();

    initialCatalog.resolve();
    await vi.waitFor(() => expect(fixture.sessions.refreshAfterReconnect).toHaveBeenCalledOnce());
    expect(fixture.calls).toEqual([
      "location",
      "connected",
      "catalog",
      "models",
      "begin-recovery",
      "location",
      "refresh-sessions",
      "models",
    ]);
    dispose();
  });

  it("continues reconnect recovery when initial feature sync fails", async () => {
    const initialFailure = new Error("catalog unavailable");
    const fixture = setup(Promise.resolve());
    fixture.sessions.syncCatalog.mockImplementationOnce(async () => {
      fixture.calls.push("catalog");
      throw initialFailure;
    });
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");

    await vi.waitFor(() => expect(fixture.sessions.refreshAfterReconnect).toHaveBeenCalledOnce());
    expect(fixture.sessions.failRecovery).not.toHaveBeenCalled();
    expect(fixture.onInitialFailure).not.toHaveBeenCalled();
    dispose();
  });

  it("does not refresh feature data after disconnecting during location recovery", async () => {
    const reconnectLocation = deferred<void>();
    const fixture = setup(Promise.resolve());
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createConnectedLifecycle(fixture);
    });
    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.runtime.data.location.syncInfo.mockImplementationOnce(async () => {
      fixture.calls.push("location");
      await reconnectLocation.promise;
    });

    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");
    await vi.waitFor(() => expect(fixture.runtime.data.location.syncInfo).toHaveBeenCalledTimes(2));
    fixture.setStatus("reconnecting");
    reconnectLocation.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.sessions.refreshAfterReconnect).not.toHaveBeenCalled();
    dispose();
  });
});
