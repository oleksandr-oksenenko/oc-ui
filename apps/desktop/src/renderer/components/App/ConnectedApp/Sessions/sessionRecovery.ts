import { Effect, Queue, Stream } from "effect";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

/** Keep the latest connection transition while a recovery is running. */
export function createReconnectRefreshQueue(effects: WorkspaceOwner, refresh: Effect.Effect<void>) {
  const transitions = Effect.runSync(Queue.sliding<boolean>(1));
  effects.runFork(
    Stream.fromQueue(transitions).pipe(
      Stream.filter((connected) => connected),
      Stream.runForEach(() => refresh),
    ),
  );
  return (connected: boolean): void => {
    Queue.offerUnsafe(transitions, connected);
  };
}
