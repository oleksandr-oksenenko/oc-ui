import type { Data } from "@opencode-ai/client/solid";

type SessionTranscriptData = {
  readonly session: Pick<Data["session"], "sync"> & {
    readonly pending: Pick<Data["session"]["pending"], "sync">;
    readonly message: Pick<Data["session"]["message"], "sync" | "more" | "loadMore">;
  };
};

const activeSyncs = new WeakMap<SessionTranscriptData, Map<string, Promise<void>>>();

/** Sync the selected session, pending inputs, and every available message page. */
export async function syncSessionTranscript(
  data: SessionTranscriptData,
  sessionID: string,
  options?: { readonly isCurrent?: () => boolean },
): Promise<void> {
  let sessions = activeSyncs.get(data);
  if (!sessions) {
    sessions = new Map();
    activeSyncs.set(data, sessions);
  }

  const previous = sessions.get(sessionID);
  const run = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
    if (options?.isCurrent && !options.isCurrent()) return undefined;

    await Promise.all([
      data.session.sync(sessionID),
      data.session.pending.sync(sessionID),
      data.session.message.sync(sessionID),
    ]);

    while (data.session.message.more(sessionID)) {
      if (options?.isCurrent && !options.isCurrent()) return undefined;
      await data.session.message.loadMore(sessionID);
    }
    return undefined;
  });

  const tracked = run.finally(() => {
    if (sessions.get(sessionID) !== tracked) return;
    sessions.delete(sessionID);
    if (sessions.size === 0) activeSyncs.delete(data);
  });
  sessions.set(sessionID, tracked);
  return tracked;
}
