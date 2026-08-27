import type { Data } from "@opencode-ai/client/solid";

type SessionTranscriptData = {
  readonly session: Pick<Data["session"], "sync"> & {
    readonly pending: Pick<Data["session"]["pending"], "sync">;
    readonly message: Pick<Data["session"]["message"], "sync" | "more" | "loadMore">;
  };
};

/** Sync the selected session, pending inputs, and every available message page. */
export async function syncSessionTranscript(
  data: SessionTranscriptData,
  sessionID: string,
  options?: { readonly isCurrent?: () => boolean },
): Promise<void> {
  await Promise.all([
    data.session.sync(sessionID),
    data.session.pending.sync(sessionID),
    data.session.message.sync(sessionID),
  ]);

  while (data.session.message.more(sessionID)) {
    if (options?.isCurrent && !options.isCurrent()) return;
    await data.session.message.loadMore(sessionID);
  }
}
