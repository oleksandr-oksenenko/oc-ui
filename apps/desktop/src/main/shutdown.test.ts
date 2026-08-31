import { describe, expect, it, vi } from "vite-plus/test";

import { disconnectSidecarForQuit } from "./shutdown.ts";

describe("disconnectSidecarForQuit", () => {
  it("settles when sidecar cleanup fails so app quit can continue", async () => {
    const disconnect = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("stop failed"));

    await expect(disconnectSidecarForQuit({ disconnect })).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
