import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client";
import type { ClientConnectionStatus } from "@opencode/client/solid";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../test/deferred.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { createConnectedRuntime } from "./runtime.ts";

const sdk = vi.hoisted(() => ({
  emit: (_event: OpenCodeEvent) => {},
  reconnect: () => {},
  syncInfo: vi.fn<() => Promise<void>>(),
}));
vi.mock("@opencode/client/solid", () => ({
  createClientConnection: (
    _api: OpenCodeClient,
    options: { onEvent: (event: OpenCodeEvent) => void },
  ) => {
    const [status, setStatus] = createSignal<ClientConnectionStatus>("connecting");
    sdk.emit = options.onEvent;
    sdk.reconnect = () => setStatus("reconnecting");
    return { status, attempt: () => 1, error: () => "handshake failed" };
  },
  createData: () => ({ location: { syncInfo: sdk.syncInfo } }),
}));
vi.mock("./session-catalog", () => ({ createSessionCatalog: () => ({}) }));
vi.mock("./vcs-diff", () => ({ createVcsDiffStore: () => ({}) }));
vi.mock("./transcript", () => ({
  createTranscriptLoader: () => ({ load: () => Effect.void }),
}));

const setup = () =>
  withTestWorkspace((effects) => ({
    effects,
    runtime: createConnectedRuntime({
      effects,
      api: OpenCode.make({ baseUrl: "http://runtime.test" }),
      defaultLocation: { directory: "/workspace" },
    }),
  }));
const connected = () => sdk.emit({ id: "connected", type: "server.connected", data: {} });

beforeEach(() => sdk.syncInfo.mockReset());

describe("Workspace readiness", () => {
  it("waits for the first handshake and location sync, retaining success across reconnect", async () => {
    const location = deferred();
    sdk.syncInfo.mockReturnValue(location.promise);
    const { runtime } = setup();
    let ready = false;
    const settled = runtime.ready.then(() => {
      ready = true;
      return undefined;
    });
    expect(sdk.syncInfo).not.toHaveBeenCalled();
    connected();
    await Promise.resolve();
    expect(sdk.syncInfo).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
    location.resolve();
    await settled;
    sdk.reconnect();
    connected();
    await runtime.ready;
    expect(sdk.syncInfo).toHaveBeenCalledOnce();
  });

  it("keeps the first failed handshake terminal even if a connected event follows", async () => {
    const { runtime } = setup();
    sdk.reconnect();
    await expect(runtime.ready).rejects.toThrow("event stream handshake failed");
    connected();
    expect(sdk.syncInfo).not.toHaveBeenCalled();
  });

  it("closes a workspace waiting for its handshake without waiting for a server event", async () => {
    const { effects, runtime } = setup();
    const interrupted = runtime.ready.catch(() => undefined);
    await Effect.runPromise(Scope.close(effects.scope, Exit.void).pipe(Effect.uninterruptible));
    await interrupted;
    expect(sdk.syncInfo).not.toHaveBeenCalled();
  });
});
