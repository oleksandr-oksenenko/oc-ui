import type { Data } from "@opencode-ai/client/solid";
import { describe, expect, it, vi } from "vite-plus/test";

import { syncSessionTranscript } from "./transcript.ts";

const makeData = (more: () => boolean) => {
  const syncSession = vi.fn<Data["session"]["sync"]>(() => Promise.resolve());
  const syncPending = vi.fn<Data["session"]["pending"]["sync"]>(() => Promise.resolve());
  const syncMessages = vi.fn<Data["session"]["message"]["sync"]>(() => Promise.resolve());
  const loadMore = vi.fn<Data["session"]["message"]["loadMore"]>(() => Promise.resolve());
  const data = {
    session: {
      sync: syncSession,
      pending: { sync: syncPending },
      message: { sync: syncMessages, more, loadMore },
    },
  };
  return { data, syncSession, syncPending, syncMessages, loadMore };
};

describe("syncSessionTranscript", () => {
  it("loads every older message page after the first snapshot", async () => {
    let remaining = 2;
    const fixture = makeData(() => remaining-- > 0);

    await syncSessionTranscript(fixture.data, "session");

    expect(fixture.syncSession).toHaveBeenCalledWith("session");
    expect(fixture.syncPending).toHaveBeenCalledWith("session");
    expect(fixture.syncMessages).toHaveBeenCalledWith("session");
    expect(fixture.loadMore).toHaveBeenCalledTimes(2);
  });

  it("stops requesting older pages after the selection changes", async () => {
    const fixture = makeData(() => true);

    await syncSessionTranscript(fixture.data, "old-session", { isCurrent: () => false });

    expect(fixture.loadMore).not.toHaveBeenCalled();
  });
});
