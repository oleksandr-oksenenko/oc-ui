import type { Data } from "@opencode/client/solid";
import { Deferred, Effect, Queue, RcMap } from "effect";

import type { WorkspaceOwner, WorkspaceRequestError } from "../workspace-owner.ts";

type SessionTranscriptData = {
  readonly session: Pick<Data["session"], "sync"> & {
    readonly pending: Pick<Data["session"]["pending"], "sync">;
    readonly message: Pick<Data["session"]["message"], "sync" | "more" | "loadMore">;
  };
};

type TranscriptRequest = {
  readonly isCurrent?: () => boolean;
  readonly result: Deferred.Deferred<void, WorkspaceRequestError>;
};

/** The SDK owns messages; one FIFO worker per session owns complete pagination. */
export function createSessionTranscriptSync(effects: WorkspaceOwner, data: SessionTranscriptData) {
  const hydrate = Effect.fn("hydrateTranscript")(function* (
    sessionID: string,
    job: TranscriptRequest,
  ) {
    if (job.isCurrent && !job.isCurrent()) return;
    yield* Effect.all(
      [
        effects.request(() => data.session.sync(sessionID)),
        effects.request(() => data.session.pending.sync(sessionID)),
        effects.request(() => data.session.message.sync(sessionID)),
      ],
      { concurrency: "unbounded" },
    );
    while (data.session.message.more(sessionID)) {
      if (job.isCurrent && !job.isCurrent()) return;
      yield* effects.request(() => data.session.message.loadMore(sessionID));
    }
  });

  const sessions = effects.runSync(
    RcMap.make({
      lookup: Effect.fn("transcript.worker")(function* (sessionID: string) {
        const queue = yield* Queue.unbounded<TranscriptRequest>();
        yield* Effect.gen(function* () {
          const job = yield* Queue.take(queue);
          yield* Deferred.complete(job.result, hydrate(sessionID, job));
        }).pipe(Effect.forever, Effect.forkScoped);
        return queue;
      }),
    }),
  );

  return (sessionID: string, options?: { readonly isCurrent?: () => boolean }): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        const queue = yield* RcMap.get(sessions, sessionID);
        const result = yield* Deferred.make<void, WorkspaceRequestError>();
        yield* Queue.offer(queue, { ...options, result });
        yield* Deferred.await(result);
      }).pipe(Effect.scoped),
    );
}
