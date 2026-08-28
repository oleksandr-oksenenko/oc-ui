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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

  it("loads a child session transcript through the same runtime path", async () => {
    const fixture = makeData(() => false);

    await syncSessionTranscript(fixture.data, "child");

    expect(fixture.syncSession).toHaveBeenCalledWith("child");
    expect(fixture.syncPending).toHaveBeenCalledWith("child");
    expect(fixture.syncMessages).toHaveBeenCalledWith("child");
  });

  it("stops requesting older pages after the selection changes", async () => {
    const fixture = makeData(() => true);

    await syncSessionTranscript(fixture.data, "old-session", { isCurrent: () => false });

    expect(fixture.loadMore).not.toHaveBeenCalled();
  });

  it("serializes overlapping pagination for the same session", async () => {
    const page = deferred();
    let loading = false;
    let pageAvailable = true;
    let checks = 0;
    const fixture = makeData(() => pageAvailable && checks++ < 4);
    fixture.loadMore.mockImplementation(async () => {
      if (loading) return;
      loading = true;
      await page.promise;
      pageAvailable = false;
      loading = false;
    });

    const first = syncSessionTranscript(fixture.data, "session");
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledTimes(1));
    const second = syncSessionTranscript(fixture.data, "session");
    await Promise.resolve();

    expect(fixture.loadMore).toHaveBeenCalledTimes(1);

    page.resolve();
    await Promise.all([first, second]);

    expect(fixture.loadMore).toHaveBeenCalledTimes(1);
  });

  it("allows a queued retry after an earlier sync fails", async () => {
    const fixture = makeData(() => false);
    fixture.syncMessages
      .mockRejectedValueOnce(new Error("first sync failed"))
      .mockResolvedValueOnce(undefined);

    const first = syncSessionTranscript(fixture.data, "session");
    const retry = syncSessionTranscript(fixture.data, "session");

    await expect(first).rejects.toThrow("first sync failed");
    await expect(retry).resolves.toBeUndefined();
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
  });
});
