// @vitest-environment node
import { EventEmitter } from "node:events";
import { OpenCode } from "@opencode/client";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { BrowserHost } from "../src/main/browser/host.ts";
import { browserIpcResult } from "../src/main/browser/ipc.ts";
import { createAppQuitHandler } from "../src/main/shutdown.ts";
import { createProfile } from "./e2e/profile.mjs";
import { startServer } from "./e2e/browser-fixture.mjs";
import { prepareProjectFixture } from "./e2e/project-fixture.ts";

// The real server, SDK and attachment lifetime run here; native Electron resources are substitutes.
const nativeBrowser = vi.hoisted(() => ({
  state: () => ({ tabs: [], focusedTabID: null }),
  checkpoint: () => ({ urls: [], focusedIndex: null }),
  dispose: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/main/browser/native.ts", () => ({ createNativeBrowser: () => nativeBrowser }));
vi.mock("../src/main/browser/network.ts", () => ({
  createBrowserNetwork: () => Effect.void,
  clearBrowserPartition: () => Promise.resolve(),
}));

it("settles browser attachments before stopping OpenCode on Quit without a transport error", async () => {
  const profile = await createProfile("ocui-browser-shutdown-");
  await prepareProjectFixture(profile.paths.app);
  const server = await startServer(profile, profile.paths.app, "https://runner.example");
  const logs = [];
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      BrowserHost.layer,
      Logger.layer([
        Logger.make((options) => {
          logs.push(options);
        }),
      ]),
    ),
  );
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: () => false,
  });
  const disposal = Promise.withResolvers();
  nativeBrowser.dispose.mockReset().mockReturnValue(disposal.promise);
  try {
    const api = OpenCode.make({ baseUrl: server.url, headers: server.headers });
    const session = await api.session.create({ title: "browser quit" });
    const host = await runtime.runPromise(BrowserHost);
    const events = [];
    const lifetime = runtime
      .runPromiseExit(
        host.attach(
          window,
          {
            bindingID: "shutdown",
            sessionID: session.id,
            serverUrl: server.url,
            password: server.password,
          },
          (event) => {
            events.push(event);
          },
        ),
      )
      .then(browserIpcResult);
    await expect.poll(() => events[0]?.status, { timeout: 10_000 }).toBe("connected");
    const stopServer = vi.fn(() => server.close());
    const quit = vi.fn();
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false });
    const handler = createAppQuitHandler({
      quiesceBrowsers: host.quiesce,
      localOpenCode: Effect.succeed({ shutdown: Effect.promise(stopServer) }),
      showMessageBox,
      cleanup: Effect.promise(async () => {
        window.webContents.emit("destroyed");
        await lifetime;
        await runtime.dispose();
      }),
      quit,
    });
    handler.beforeQuit({ preventDefault() {} });
    await expect.poll(() => nativeBrowser.dispose.mock.calls.length, { timeout: 10_000 }).toBe(1);
    expect(stopServer).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    disposal.resolve();
    await expect.poll(() => quit.mock.calls.length, { timeout: 15_000 }).toBe(1);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(stopServer).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ status: "closed", error: undefined });
    expect(logs).toEqual([]);
  } finally {
    disposal.resolve();
    await runtime.dispose();
    await server.close();
    await profile.remove();
  }
}, 45_000);
