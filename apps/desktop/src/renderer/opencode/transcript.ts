import type { Data } from "@opencode/client/solid";
import { Effect, RcMap, Scope, Semaphore } from "effect";

import type { WorkspaceOwner, WorkspaceRequestError } from "../workspace-owner.ts";

type SessionTranscriptData = {
  readonly session: Pick<Data["session"], "sync"> & {
    readonly pending: Pick<Data["session"]["pending"], "sync">;
    readonly message: Pick<Data["session"]["message"], "sync" | "more" | "loadMore">;
  };
};

export type TranscriptLoader = {
  /**
   * Synchronizes a session's transcript and drains the remaining history in one
   * bulk read. Runs in the caller's fiber: interrupting the caller aborts the
   * in-flight read, and the session's permit stays held until the native
   * operation and its cleanup settle.
   */
  readonly load: (sessionID: string) => Effect.Effect<void, WorkspaceRequestError, Scope.Scope>;
};

/**
 * The SDK owns messages. One permit per session serializes overlapping loads,
 * so a replacement waits for the previous operation's cleanup, while different
 * sessions stay independent. Initial syncs cannot be cancelled by this SDK
 * version and stay owned until they settle; only the bulk drain forwards the
 * caller's abort signal.
 */
export function createTranscriptLoader(
  effects: WorkspaceOwner,
  data: SessionTranscriptData,
): TranscriptLoader {
  const gates = effects.runSync(RcMap.make({ lookup: () => Semaphore.make(1) }));

  const load = Effect.fn("loadTranscript")(function* (sessionID: string) {
    const gate = yield* RcMap.get(gates, sessionID);
    yield* gate.withPermits(1)(
      Effect.gen(function* () {
        yield* Effect.all(
          [
            effects.request(() => data.session.sync(sessionID)),
            effects.request(() => data.session.pending.sync(sessionID)),
            effects.request(() => data.session.message.sync(sessionID)),
          ],
          { concurrency: "unbounded" },
        );
        if (data.session.message.more(sessionID)) {
          yield* effects.request((signal) =>
            data.session.message.loadMore(sessionID, { all: true, signal }),
          );
        }
      }),
    );
  });

  return { load };
}
