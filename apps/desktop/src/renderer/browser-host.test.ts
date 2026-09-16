import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBrowserHost } from "./browser-host.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser connection settings", () => {
  it("remembers only the normalized address across host instances", async () => {
    const host = createBrowserHost();
    expect(await host.target.load()).toBeUndefined();
    expect(
      await host.target.saveRemote({ serverUrl: "HTTPS://SERVER:443/", password: "secret" }),
    ).toEqual({ passwordSaved: false });
    expect(localStorage.getItem("ocui.connection.v1")).toBe(
      '{"version":1,"serverUrl":"https://server"}',
    );
    expect(await createBrowserHost().target.load()).toEqual({
      kind: "remote",
      serverUrl: "https://server",
    });
    await host.target.clear();
    expect(await createBrowserHost().target.load()).toBeUndefined();
  });

  it.each([
    "not json",
    '{"version":2,"serverUrl":"https://server"}',
    '{"version":1,"serverUrl":"https://user:secret@server"}',
    '{"version":1,"serverUrl":"https://server","password":"secret"}',
  ])("rejects corrupt or unexpected stored data: %s", async (value) => {
    localStorage.setItem("ocui.connection.v1", value);
    await expect(createBrowserHost().target.load()).rejects.toBeDefined();
  });

  it("can be created with denied storage and reports read, write, and clear failures", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    const host = createBrowserHost();
    await expect(host.target.load()).rejects.toBeDefined();
    await expect(host.target.saveRemote({ serverUrl: "https://server" })).rejects.toBeDefined();
    await expect(host.target.clear()).rejects.toBeDefined();
  });

  it("opens external links in a new tab and rejects non-web URLs", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(
      createBrowserHost().openExternal("https://example.test/docs"),
    ).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith("https://example.test/docs", "_blank", "noopener,noreferrer");

    await expect(createBrowserHost().openExternal("javascript:alert(1)")).rejects.toBeDefined();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
