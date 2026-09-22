// @vitest-environment node
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCdp } from "./cdp.ts";

function setup() {
  const sends: PromiseWithResolvers<unknown>[] = [];
  const debuggerApi = {
    attached: false,
    isAttached: () => debuggerApi.attached,
    attach: vi.fn(() => {
      debuggerApi.attached = true;
    }),
    detach: vi.fn(() => {
      debuggerApi.attached = false;
    }),
    on: vi.fn(),
    off: vi.fn(),
    sendCommand: vi.fn(() => {
      const entry = Promise.withResolvers<unknown>();
      sends.push(entry);
      return entry.promise;
    }),
  };
  // SAFETY: The adapter only touches these members; no real debugger is involved.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal Electron fixture.
  const contents = { isDestroyed: () => false, debugger: debuggerApi } as unknown as WebContents;
  return { cdp: createCdp(contents), debuggerApi, sends };
}

describe("cdp terminal closure", () => {
  it("rejects pending and future sends on close", async () => {
    const fixture = setup();
    const first = fixture.cdp.send("Page.enable");
    const second = fixture.cdp.send("DOM.enable");
    const failure = new Error("The browser tab was retired.");
    fixture.cdp.close(failure);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    await expect(fixture.cdp.send("Page.enable")).rejects.toBe(failure);
    expect(fixture.debuggerApi.sendCommand).toHaveBeenCalledTimes(2);
    expect(fixture.debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it("ignores a late raw settlement and closes once", async () => {
    const fixture = setup();
    const pending = fixture.cdp.send("Page.enable");
    fixture.cdp.close(new Error("first"));
    fixture.cdp.close(new Error("second"));
    fixture.sends[0]!.resolve({});
    await expect(pending).rejects.toThrow("first");
    expect(fixture.debuggerApi.detach).toHaveBeenCalledTimes(1);
  });

  it("settles normally before closure", async () => {
    const fixture = setup();
    const pending = fixture.cdp.send("Page.enable");
    fixture.sends[0]!.resolve({ ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
