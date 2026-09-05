import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createReconnectRefreshQueue } from "./sessionRecovery.ts";

describe("session recovery", () => {
  it("runs one queued refresh after reconnecting during an active refresh", async () => {
    const first = deferred();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const transition = withTestWorkspace((effects) =>
      createReconnectRefreshQueue(effects, effects.request(refresh).pipe(Effect.ignore)),
    );

    transition(false);
    transition(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    transition(false);
    transition(true);
    transition(false);
    transition(true);

    expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("discards a pending reconnect superseded by disconnect and does not retry a failure", async () => {
    const first = deferred();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const transition = withTestWorkspace((effects) =>
      createReconnectRefreshQueue(effects, effects.request(refresh).pipe(Effect.ignore)),
    );

    transition(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    transition(true);
    transition(false);
    first.reject(new Error("connection lost"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);

    transition(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
});
