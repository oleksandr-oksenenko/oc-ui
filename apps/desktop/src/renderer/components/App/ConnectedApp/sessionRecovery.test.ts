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

  it("rehydrates the selected transcript after refreshing the catalog", async () => {
    const syncCatalog = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const hydrateTranscript = vi
      .fn<(sessionID: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    await retryCatalogAndTranscript(syncCatalog, () => "session", hydrateTranscript);

    expect(syncCatalog).toHaveBeenCalledOnce();
    expect(hydrateTranscript).toHaveBeenCalledWith("session");
  });
});
