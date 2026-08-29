import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";

import type { ConnectedRuntime } from "../../../opencode/runtime.ts";
import { createReconnectRefreshQueue } from "./Sessions/sessionRecovery.ts";

type ConnectedLifecycleRuntime = Pick<ConnectedRuntime, "ready" | "defaultLocation"> & {
  readonly data: {
    readonly location: {
      readonly syncInfo: (
        location: ConnectedRuntime["defaultLocation"],
      ) => ReturnType<ConnectedRuntime["data"]["location"]["syncInfo"]>;
    };
  };
};

type ConnectedLifecycleSessions = {
  readonly syncCatalog: () => Promise<void>;
  readonly beginRecovery: () => void;
  readonly refreshAfterReconnect: () => Promise<void>;
  readonly failRecovery: () => void;
};

export type ConnectedLifecycleOptions = {
  readonly runtime: ConnectedLifecycleRuntime;
  readonly bootstrapped: Accessor<boolean>;
  readonly markBootstrapped: () => void;
  readonly connected: Accessor<boolean>;
  readonly sessions: ConnectedLifecycleSessions;
  readonly syncSelections: () => Promise<void>;
  readonly onConnected: () => void;
  readonly onInitialFailure: (cause: unknown) => void;
};

/** Owns initial connection setup and reconnect refresh ordering. */
export function createConnectedLifecycle(options: ConnectedLifecycleOptions): void {
  let alive = true;
  let initialFeatureSync = Promise.resolve();

  onCleanup(() => {
    alive = false;
  });

  onMount(() => {
    void (async () => {
      try {
        await options.runtime.ready;
        await options.runtime.data.location.syncInfo(options.runtime.defaultLocation);
        if (!alive) return;
        options.onConnected();
        options.markBootstrapped();
        initialFeatureSync = Promise.all([
          options.sessions.syncCatalog().catch(() => undefined),
          options.syncSelections().catch(() => undefined),
        ]).then(() => undefined);
        await initialFeatureSync;
      } catch (cause) {
        if (alive) options.onInitialFailure(cause);
      }
    })();
  });

  const reconnectRefresh = createReconnectRefreshQueue(
    async () => {
      options.sessions.beginRecovery();
      try {
        await initialFeatureSync;
        if (!alive || !options.connected()) return;
        await options.runtime.data.location.syncInfo(options.runtime.defaultLocation);
        if (!alive || !options.connected()) return;
        await Promise.all([
          options.sessions.refreshAfterReconnect(),
          options.syncSelections().catch(() => undefined),
        ]);
      } catch {
        if (alive) options.sessions.failRecovery();
      }
    },
    () => alive && options.connected(),
  );

  createEffect(() => {
    const connected = options.connected();
    if (!options.bootstrapped()) return;
    if (!connected) {
      reconnectRefresh.markDisconnected();
      return;
    }
    reconnectRefresh.refreshIfPending();
  });
}
