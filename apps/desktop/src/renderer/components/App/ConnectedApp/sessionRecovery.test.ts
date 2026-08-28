import { describe, expect, it, vi } from "vite-plus/test";

import { createReconnectRefreshQueue, retryCatalogAndTranscript } from "./sessionRecovery.ts";

describe("session recovery", () => {
  it("runs one queued refresh after reconnecting during an active refresh", async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const queue = createReconnectRefreshQueue(refresh, () => true);

    queue.markDisconnected();
    queue.refreshIfPending();
    queue.markDisconnected();
    queue.refreshIfPending();

    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("rehydrates a selected child transcript after refreshing the catalog", async () => {
    const order: string[] = [];
    const syncCatalog = vi.fn<() => Promise<void>>(async () => {
      order.push("catalog");
    });
    const hydrateTranscript = vi
      .fn<(sessionID: string) => Promise<void>>()
      .mockImplementation(async (sessionID) => {
        order.push(`transcript:${sessionID}`);
      });

    await retryCatalogAndTranscript(syncCatalog, () => "child", hydrateTranscript);

    expect(syncCatalog).toHaveBeenCalledOnce();
    expect(hydrateTranscript).toHaveBeenCalledWith("child");
    expect(order).toEqual(["catalog", "transcript:child"]);
  });
});
