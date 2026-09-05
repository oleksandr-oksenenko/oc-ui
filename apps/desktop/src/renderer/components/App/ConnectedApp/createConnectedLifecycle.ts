import { Deferred, Effect } from "effect";
import { createEffect, on, onMount, type Accessor } from "solid-js";

import type { ConnectedRuntime } from "../../../opencode/runtime.ts";
import type { WorkspaceOwner } from "../../../workspace-owner.ts";
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
  readonly effects: WorkspaceOwner;
  readonly runtime: ConnectedLifecycleRuntime;
  readonly bootstrapped: Accessor<boolean>;
  readonly markBootstrapped: () => void;
  readonly connected: Accessor<boolean>;
  readonly sessions: ConnectedLifecycleSessions;
  readonly syncSelectedFeatures: () => Promise<void>;
};

/** Connection owns readiness; this owner orders initial and reconnect feature refresh. */
export function createConnectedLifecycle(options: ConnectedLifecycleOptions): void {
  const { effects } = options;
  const initialSync = Deferred.makeUnsafe<void>();
  onMount(() => {
    effects.runFork(
      Effect.gen(function* () {
        yield* Effect.tryPromise(() => options.runtime.ready);
        options.markBootstrapped();
        yield* Effect.all(
          [
            Effect.tryPromise(options.sessions.syncCatalog).pipe(Effect.ignore),
            Effect.tryPromise(options.syncSelectedFeatures).pipe(Effect.ignore),
          ],
          { concurrency: "unbounded" },
        );
      }).pipe(Effect.ignore, Effect.ensuring(Deferred.succeed(initialSync, undefined))),
    );
  });

  const transition = createReconnectRefreshQueue(
    effects,
    Effect.gen(function* () {
      options.sessions.beginRecovery();
      yield* Deferred.await(initialSync);
      if (!options.connected()) return;
      yield* effects.request(() =>
        options.runtime.data.location.syncInfo(options.runtime.defaultLocation),
      );
      if (!options.connected()) return;
      yield* Effect.all(
        [
          Effect.tryPromise<void>(options.sessions.refreshAfterReconnect),
          Effect.tryPromise(options.syncSelectedFeatures).pipe(Effect.ignore),
        ],
        { concurrency: "unbounded" },
      );
    }).pipe(Effect.catch(() => Effect.sync(options.sessions.failRecovery))),
  );

  createEffect(
    on(
      options.connected,
      (connected) => {
        if (options.bootstrapped()) transition(connected);
      },
      { defer: true },
    ),
  );
}
