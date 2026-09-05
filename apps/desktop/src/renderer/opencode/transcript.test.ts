import type { Data } from "@opencode-ai/client/solid";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../test/workspace.ts";
import { deferred } from "../test/deferred.ts";
import { createSessionTranscriptSync } from "./transcript.ts";

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
  return withTestWorkspace((effects) => ({
    effects,
    data,
    syncSession,
    syncPending,
    syncMessages,
    loadMore,
    syncTranscript: createSessionTranscriptSync(effects, data),
  }));
};

describe("syncSessionTranscript", () => {
  it("loads every older message page after the first snapshot", async () => {
    let remaining = 2;
    const fixture = makeData(() => remaining-- > 0);

    await fixture.syncTranscript("session");

    expect(fixture.syncSession).toHaveBeenCalledWith("session");
    expect(fixture.syncPending).toHaveBeenCalledWith("session");
    expect(fixture.syncMessages).toHaveBeenCalledWith("session");
    expect(fixture.loadMore).toHaveBeenCalledTimes(2);
  });

  it("loads a child session transcript through the same runtime path", async () => {
    const fixture = makeData(() => false);

    await fixture.syncTranscript("child");

    expect(fixture.syncSession).toHaveBeenCalledWith("child");
    expect(fixture.syncPending).toHaveBeenCalledWith("child");
    expect(fixture.syncMessages).toHaveBeenCalledWith("child");
  });

  it("stops requesting older pages after the selection changes", async () => {
    const fixture = makeData(() => true);

    await fixture.syncTranscript("old-session", { isCurrent: () => false });

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

    const first = fixture.syncTranscript("session");
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledTimes(1));
    const second = fixture.syncTranscript("session");
    await Promise.resolve();

    expect(fixture.loadMore).toHaveBeenCalledTimes(1);
    expect(fixture.syncMessages).toHaveBeenCalledTimes(1);

    page.resolve();
    await Promise.all([first, second]);

    expect(fixture.loadMore).toHaveBeenCalledTimes(1);
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
    await fixture.syncTranscript("session");
    expect(fixture.syncMessages).toHaveBeenCalledTimes(3);
  });

  it("releases idle session workers instead of accumulating workspace finalizers", async () => {
    const fixture = makeData(() => false);
    const finalizerCount = () => {
      const state = fixture.effects.scope.state;
      return state._tag === "Open"
        ? Number(state.finalizer !== undefined) + (state.finalizers?.size ?? 0)
        : 0;
    };
    const before = finalizerCount();
    for (const sessionID of ["first", "second", "third"]) {
      await fixture.syncTranscript(sessionID);
      expect(finalizerCount()).toBe(before);
    }
  });

  it("allows a queued retry after an earlier sync fails", async () => {
    const fixture = makeData(() => false);
    fixture.syncMessages
      .mockRejectedValueOnce(new Error("first sync failed"))
      .mockResolvedValueOnce(undefined);

    const first = fixture.syncTranscript("session");
    const retry = fixture.syncTranscript("session");

    await expect(first).rejects.toMatchObject({
      _tag: "WorkspaceRequestError",
      cause: new Error("first sync failed"),
    });
    await expect(retry).resolves.toBeUndefined();
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
  });
  it("settles active and queued callers while shutdown awaits native pagination", async () => {
    const page = deferred();
    const fixture = makeData(() => true);
    fixture.loadMore.mockReturnValueOnce(page.promise);
    const first = fixture.syncTranscript("session").catch(() => undefined);
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledOnce());
    const queued = fixture.syncTranscript("session").catch(() => undefined);
    let closed = false;
    const closing = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    page.resolve();
    await Promise.all([first, queued, closing]);
    expect(fixture.syncSession).toHaveBeenCalledOnce();
    expect(fixture.loadMore).toHaveBeenCalledOnce();
    expect(closed).toBe(true);
  });
});
