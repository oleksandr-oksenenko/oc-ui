import type { Data } from "@opencode/client/solid";
import { Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../test/workspace.ts";
import { deferred } from "../test/deferred.ts";
import type { WorkspaceRequestError } from "../workspace-owner.ts";
import { createTranscriptLoader } from "./transcript.ts";

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
    loader: createTranscriptLoader(effects, data),
  }));
};

type Fixture = ReturnType<typeof makeData>;

const load = (fixture: Fixture, sessionID: string) =>
  fixture.effects.runPromise(Effect.scoped(fixture.loader.load(sessionID)));

describe("createTranscriptLoader", () => {
  it("hydrates a session and does not drain a complete history", async () => {
    const fixture = makeData(() => false);

    await load(fixture, "session");

    expect(fixture.syncSession).toHaveBeenCalledWith("session");
    expect(fixture.syncPending).toHaveBeenCalledWith("session");
    expect(fixture.syncMessages).toHaveBeenCalledWith("session");
    expect(fixture.loadMore).not.toHaveBeenCalled();
  });

  it("bulk-loads remaining history in one call with an abort signal", async () => {
    const fixture = makeData(() => true);

    await load(fixture, "session");

    expect(fixture.loadMore).toHaveBeenCalledTimes(1);
    expect(fixture.loadMore).toHaveBeenCalledWith("session", {
      all: true,
      signal: expect.any(AbortSignal),
    });
  });

  it("aborts the bulk read when the caller is interrupted", async () => {
    const fixture = makeData(() => true);
    let observed: AbortSignal | undefined;
    fixture.loadMore.mockImplementation(
      async (_sessionID, options) =>
        await new Promise<void>((resolve) => {
          observed = options?.signal;
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    const fiber = fixture.effects.runFork(Effect.scoped(fixture.loader.load("session")));
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledTimes(1));
    fiber.interruptUnsafe();
    await Effect.runPromise(Fiber.await(fiber));

    expect(observed?.aborted).toBe(true);
    expect(fixture.loadMore).toHaveBeenCalledTimes(1);
  });

  it("interrupts an abort-ignoring bulk read and holds its permit for the replacement", async () => {
    const fixture = makeData(() => true);
    const page = deferred();
    const reads = fixture.effects.latest<void, WorkspaceRequestError>();
    let observed: AbortSignal | undefined;
    fixture.loadMore.mockImplementationOnce(async (_sessionID, options) => {
      observed = options?.signal;
      await page.promise; // Ignores cancellation and stays unsettled.
    });

    const first = reads.run(fixture.loader.load("session"));
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledTimes(1));
    const replacement = reads.run(fixture.loader.load("session"));
    await Promise.resolve();

    expect(observed?.aborted).toBe(true);
    expect(fixture.syncMessages).toHaveBeenCalledTimes(1);
    expect(fixture.loadMore).toHaveBeenCalledTimes(1);

    page.resolve();
    await Effect.runPromise(Fiber.await(first));
    await Effect.runPromise(Fiber.await(replacement));
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
    expect(fixture.loadMore).toHaveBeenCalledTimes(2);
  });

  it("runs different sessions concurrently", async () => {
    const fixture = makeData(() => false);
    const slow = deferred();
    fixture.syncSession.mockImplementation(async (sessionID: string) => {
      if (sessionID === "slow") await slow.promise;
    });

    const pending = load(fixture, "slow");
    await vi.waitFor(() => expect(fixture.syncSession).toHaveBeenCalledWith("slow"));
    await load(fixture, "fast");
    expect(fixture.syncMessages).toHaveBeenCalledWith("fast");

    slow.resolve();
    await pending;
  });

  it("does not hydrate a queued waiter interrupted before its permit", async () => {
    const fixture = makeData(() => true);
    const page = deferred();
    fixture.loadMore.mockReturnValueOnce(page.promise);

    const first = load(fixture, "session");
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledTimes(1));
    const waiter = fixture.effects.runFork(Effect.scoped(fixture.loader.load("session")));
    await Promise.resolve();
    waiter.interruptUnsafe();

    page.resolve();
    await first;
    await Effect.runPromise(Fiber.await(waiter));
    expect(fixture.syncMessages).toHaveBeenCalledTimes(1);
  });

  it("holds the permit until an unsettled sibling sync finishes after a failure", async () => {
    const fixture = makeData(() => false);
    const sibling = deferred();
    fixture.syncMessages.mockRejectedValueOnce(new Error("message sync failed"));
    fixture.syncSession.mockImplementation(async () => {
      await sibling.promise;
    });

    const first = load(fixture, "session").catch(() => undefined);
    await vi.waitFor(() => expect(fixture.syncMessages).toHaveBeenCalledTimes(1));
    const second = load(fixture, "session");
    await Promise.resolve();
    expect(fixture.syncMessages).toHaveBeenCalledTimes(1);

    sibling.resolve();
    await first;
    await second;
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
  });

  it("owns an interrupted initial sync until it settles and starts no drain", async () => {
    const fixture = makeData(() => true);
    const gate = deferred();
    fixture.syncMessages.mockImplementation(async () => {
      await gate.promise;
    });

    const fiber = fixture.effects.runFork(Effect.scoped(fixture.loader.load("session")));
    await vi.waitFor(() => expect(fixture.syncMessages).toHaveBeenCalledTimes(1));
    fiber.interruptUnsafe();
    await Promise.resolve();
    expect(fixture.loadMore).not.toHaveBeenCalled();

    gate.resolve();
    await Effect.runPromise(Fiber.await(fiber));
    expect(fixture.loadMore).not.toHaveBeenCalled();
  });

  it("allows a retry after an earlier load fails", async () => {
    const fixture = makeData(() => false);
    fixture.syncMessages
      .mockRejectedValueOnce(new Error("first sync failed"))
      .mockResolvedValueOnce(undefined);

    const first = load(fixture, "session");
    const retry = load(fixture, "session");

    await expect(first).rejects.toMatchObject({
      _tag: "WorkspaceRequestError",
      cause: new Error("first sync failed"),
    });
    await expect(retry).resolves.toBeUndefined();
    expect(fixture.syncMessages).toHaveBeenCalledTimes(2);
  });

  it("settles active and queued callers while shutdown awaits native pagination", async () => {
    const fixture = makeData(() => true);
    const page = deferred();
    fixture.loadMore.mockReturnValueOnce(page.promise);

    const first = load(fixture, "session").catch(() => undefined);
    await vi.waitFor(() => expect(fixture.loadMore).toHaveBeenCalledOnce());
    const queued = load(fixture, "session").catch(() => undefined);
    let closed = false;
    const closing = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    page.resolve();
    await Promise.all([first, queued, closing]);
    expect(closed).toBe(true);
    expect(fixture.syncMessages).toHaveBeenCalledTimes(1);
  });

  it("releases idle session gates instead of accumulating workspace finalizers", async () => {
    const fixture = makeData(() => false);
    // Effect rc.112 exposes scope state but no public retained-gate count.
    // Keep this narrow version-sensitive leak check: shutdown alone cannot
    // detect gates accumulating while a workspace stays open.
    const finalizerCount = () => {
      const state = fixture.effects.scope.state;
      return state._tag === "Open"
        ? Number(state.finalizer !== undefined) + (state.finalizers?.size ?? 0)
        : 0;
    };
    const before = finalizerCount();
    for (const sessionID of ["first", "second", "third"]) {
      await load(fixture, sessionID);
      expect(finalizerCount()).toBe(before);
    }
  });
});
