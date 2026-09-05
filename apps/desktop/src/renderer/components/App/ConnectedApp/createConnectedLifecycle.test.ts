import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../../../test/workspace.ts";
import { deferred } from "../../../test/deferred.ts";
import { createConnectedLifecycle } from "./createConnectedLifecycle.ts";

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
  const syncSelectedFeatures = vi.fn<() => Promise<void>>(async () => {
    calls.push("models");
  });
  const markBootstrapped = vi.fn<() => void>(() => setBootstrapped(true));

  return {
    bootstrapped,
    markBootstrapped,
    connected: () => status() === "connected",
    calls,
    sessions,
    runtime,
    setStatus,
    syncSelectedFeatures,
  };
}

function mount(fixture: ReturnType<typeof setup>) {
  return withTestWorkspace((effects, dispose) => {
    createConnectedLifecycle({ ...fixture, effects });
    return () => {
      dispose();
      void Effect.runPromise(Scope.close(effects.scope, Exit.void));
    };
  });
}

describe("createConnectedLifecycle", () => {
  it("refreshes feature data after Connection readiness", async () => {
    const fixture = setup(Promise.resolve());
    const dispose = mount(fixture);

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    expect(fixture.calls).toEqual(["catalog", "models"]);
    expect(fixture.runtime.data.location.syncInfo).not.toHaveBeenCalled();
    dispose();
  });

  it("does not bootstrap features when Connection readiness fails", async () => {
    const failure = new Error("offline");
    const fixture = setup(Promise.reject(failure));
    const dispose = mount(fixture);

    await Promise.resolve();
    expect(fixture.sessions.syncCatalog).not.toHaveBeenCalled();
    expect(fixture.markBootstrapped).not.toHaveBeenCalled();
    dispose();
  });

  it("does not publish setup results after its owner is disposed", async () => {
    const ready = deferred();
    const fixture = setup(ready.promise);
    const dispose = mount(fixture);

    dispose();
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.markBootstrapped).not.toHaveBeenCalled();
    expect(fixture.sessions.syncCatalog).not.toHaveBeenCalled();
  });

  it("waits for initial feature sync before refreshing after reconnect", async () => {
    const initialCatalog = deferred();
    const fixture = setup(Promise.resolve());
    fixture.sessions.syncCatalog.mockImplementationOnce(async () => {
      fixture.calls.push("catalog");
      await initialCatalog.promise;
    });
    const dispose = mount(fixture);

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");
    await Promise.resolve();

    expect(fixture.sessions.refreshAfterReconnect).not.toHaveBeenCalled();

    initialCatalog.resolve();
    await vi.waitFor(() => expect(fixture.sessions.refreshAfterReconnect).toHaveBeenCalledOnce());
    expect(fixture.syncSelectedFeatures).toHaveBeenCalledTimes(2);
    expect(fixture.calls).toEqual([
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
    const dispose = mount(fixture);

    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");

    await vi.waitFor(() => expect(fixture.sessions.refreshAfterReconnect).toHaveBeenCalledOnce());
    expect(fixture.sessions.failRecovery).not.toHaveBeenCalled();
    expect(fixture.markBootstrapped).toHaveBeenCalledOnce();
    dispose();
  });

  it("does not refresh feature data after disconnecting during location recovery", async () => {
    const reconnectLocation = deferred();
    const fixture = setup(Promise.resolve());
    const dispose = mount(fixture);
    await vi.waitFor(() => expect(fixture.sessions.syncCatalog).toHaveBeenCalledOnce());
    fixture.runtime.data.location.syncInfo.mockImplementationOnce(async () => {
      fixture.calls.push("location");
      await reconnectLocation.promise;
    });

    fixture.setStatus("reconnecting");
    fixture.setStatus("connected");
    await vi.waitFor(() => expect(fixture.runtime.data.location.syncInfo).toHaveBeenCalledTimes(1));
    fixture.setStatus("reconnecting");
    reconnectLocation.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.sessions.refreshAfterReconnect).not.toHaveBeenCalled();
    dispose();
  });
  it("closes while readiness is owned by an earlier workspace fiber", async () => {
    const { state, owner } = withTestWorkspace((effects) => {
      const fixture = setup(effects.runPromise(Effect.never));
      createConnectedLifecycle({ ...fixture, effects });
      return { state: fixture, owner: effects };
    });
    await Effect.runPromise(Scope.close(owner.scope, Exit.void));
    expect(state.markBootstrapped).not.toHaveBeenCalled();
    expect(state.sessions.syncCatalog).not.toHaveBeenCalled();
  });
});
