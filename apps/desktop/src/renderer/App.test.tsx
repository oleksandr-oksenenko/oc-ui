import { render } from "solid-js/web";
import { onCleanup } from "solid-js";
import { RegistryContext } from "@effect/atom-solid";
import { createRenderer } from "./connection.ts";
import { createBrowserHost } from "./browser-host.ts";
import type { AppHost } from "../shared/app-host.ts";
import type { WorkspaceOwner } from "./workspace-owner.ts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "./test/deferred.ts";
import type {
  DesktopApi,
  LocalOpenCodeConnectResult,
  OpenCodeTarget,
} from "../shared/desktop-api.ts";
const verifyServer = vi.hoisted(() =>
  vi.fn<
    (
      input: { serverUrl: string; password: string },
      signal?: AbortSignal,
    ) => Promise<{ readonly serverUrl: string }>
  >(),
);

vi.mock("./opencode/index.ts", () => ({
  OpenCodeConnectionError: class extends Error {},
  ServerProvider: (props: { readonly children?: unknown }) => props.children,
  verifyServer: (input: { serverUrl: string; password: string }) =>
    Effect.tryPromise((signal) => verifyServer(input, signal)),
}));

const handshake = vi.hoisted(() => ({
  connect: () => {},
  fail: (_cause: Error) => {},
  disposed: vi.fn<() => void>(),
}));
vi.mock("./opencode/runtime.ts", () => ({
  createConnectedRuntime: (input: { effects: WorkspaceOwner }) => {
    onCleanup(handshake.disposed);
    return {
      effects: input.effects,
      ready: input.effects.runPromise(
        Effect.callback<void, Error>((resume) => {
          handshake.connect = () => resume(Effect.void);
          handshake.fail = (cause: Error) => resume(Effect.fail(cause));
        }),
      ),
    };
  },
}));

vi.mock("./components/App/ConnectedApp/createWorkspace.ts", () => ({
  createWorkspaceModel: () => ({ drafts: { flushSelected: () => undefined } }),
}));

vi.mock("./components/App/ConnectedApp.tsx", () => ({
  ConnectedApp: (props: { readonly onChangeServer: () => void }) => (
    <>
      <button type="button" data-testid="connected" onClick={() => handshake.connect()}>
        Connected
      </button>
      <button type="button" data-testid="change-server" onClick={props.onChangeServer}>
        Change server
      </button>
    </>
  ),
}));

import { App } from "./App.tsx";

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const makeDesktop = (options: {
  readonly load: () => Promise<OpenCodeTarget | undefined>;
  readonly clear?: () => Promise<void>;
  readonly connectLocal?: () => Promise<LocalOpenCodeConnectResult>;
  readonly onUnavailable?: (listener: () => void) => () => void;
}): Extract<AppHost, { kind: "desktop" }> => ({
  kind: "desktop",
  openExternal: vi.fn<(url: string) => Promise<void>>(() => Promise.resolve()),
  saveFile: vi.fn<DesktopApi["saveFile"]>(() => Promise.resolve()),
  target: {
    load: options.load,
    saveLocal: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    saveRemote: vi.fn<DesktopApi["target"]["saveRemote"]>(() =>
      Promise.resolve({ passwordSaved: true }),
    ),
    clear: options.clear ?? vi.fn<() => Promise<void>>(() => Promise.resolve()),
  },
  localOpenCode: {
    connect:
      options.connectLocal ??
      vi.fn<() => Promise<LocalOpenCodeConnectResult>>(() =>
        Promise.resolve({
          status: "connected",
          connection: { serverUrl: "http://127.0.0.1:4096", password: "local-secret" },
        }),
      ),
    onUnavailable: options.onUnavailable ?? (() => () => undefined),
  },
});

const mount = (appHost: AppHost) => {
  const host = document.createElement("div");
  document.body.append(host);
  const renderer = createRenderer(appHost);
  const disposeView = render(
    () => (
      <RegistryContext.Provider value={renderer.registry}>
        <App renderer={renderer} />
      </RegistryContext.Provider>
    ),
    host,
  );
  return {
    host,
    renderer,
    disposeView,
    dispose: () => {
      disposeView();
      void renderer.dispose();
    },
  };
};

afterEach(() => {
  verifyServer.mockReset();
  handshake.disposed.mockClear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser connections", () => {
  it("prefills an address without auto-connecting and cannot select or start a built-in server", async () => {
    const browser = createBrowserHost();
    await browser.target.saveRemote({ serverUrl: "https://server", password: "secret" });
    const { host, renderer, dispose } = mount(browser);
    await flush();
    expect(verifyServer).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="url"]')?.value).toBe(
      "https://server",
    );
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    expect(host.textContent).not.toContain("Built-in");
    renderer.connection.setMode("local");
    renderer.connection.connect("local");
    expect(renderer.registry.get(renderer.connection.state).mode).toBe("remote");
    expect(verifyServer).not.toHaveBeenCalled();
    renderer.connection.forget();
    await flush();
    expect(renderer.registry.get(renderer.connection.state)).toMatchObject({
      mode: "remote",
      serverUrl: "",
      savedTarget: undefined,
    });
    dispose();
  });

  it("keeps a connected workspace when saving browser settings fails", async () => {
    const { renderer, dispose } = mount(createBrowserHost());
    await flush();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    verifyServer.mockResolvedValue({ serverUrl: "https://server" });
    renderer.connection.connect("remote", { serverUrl: "https://server", password: "secret" });
    await flush();
    handshake.connect();
    await flush();
    expect(renderer.registry.get(renderer.connection.state)).toMatchObject({
      status: "connected",
      password: "",
      notice: "The connection works, but its settings could not be saved.",
    });
    expect(renderer.registry.get(renderer.connection.state).savedTarget).toBeUndefined();
    renderer.connection.changeServer();
    await flush();
    expect(renderer.registry.get(renderer.connection.state)).toMatchObject({
      mode: "remote",
      password: "",
      serverUrl: "https://server",
    });
    dispose();
  });

  it("allows manual connection after corrupt storage and preserves a failed Forget", async () => {
    localStorage.setItem("ocui.connection.v1", "broken");
    const { renderer, dispose } = mount(createBrowserHost());
    await flush();
    expect(renderer.registry.get(renderer.connection.state)).toMatchObject({
      status: "disconnected",
      mode: "remote",
      notice: expect.any(String),
    });
    verifyServer.mockResolvedValue({ serverUrl: "https://server" });
    renderer.connection.connect("remote", { serverUrl: "https://server", password: "" });
    await flush();
    handshake.connect();
    await flush();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderer.connection.forget();
    await flush();
    expect(renderer.registry.get(renderer.connection.state)).toMatchObject({
      status: "failed",
      savedTarget: { kind: "remote", serverUrl: "https://server" },
      error: expect.stringContaining("could not be forgotten"),
    });
    dispose();
  });
});

describe("App target startup", () => {
  it.each([
    undefined,
    { kind: "local" } as const,
    { kind: "remote", serverUrl: "http://remote.test:4096", password: "saved-secret" } as const,
  ])("starts built-in without a chooser for saved target %j", async (target) => {
    const started = deferred<LocalOpenCodeConnectResult>();
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>(() => started.promise);
    const desktop = makeDesktop({
      load: vi.fn<() => Promise<OpenCodeTarget | undefined>>(() => Promise.resolve(target)),
      connectLocal: localConnect,
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { host, dispose } = mount(desktop);
    expect(host.textContent).toContain("Starting OpenCode");
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    await flush();
    expect(localConnect).toHaveBeenCalledOnce();
    expect(desktop.target.load).not.toHaveBeenCalled();
    started.resolve({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "local-secret" },
    });
    await flush();
    expect(desktop.target.saveLocal).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Starting OpenCode");
    handshake.connect();
    await flush();
    expect(host.querySelector('[data-testid="connected"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="OpenCode startup"]')).toBeNull();
    expect(desktop.target.saveLocal).toHaveBeenCalledOnce();
    expect(desktop.target.saveRemote).not.toHaveBeenCalled();
    dispose();
  });

  it("retries a failed automatic start without opening the chooser", async () => {
    const localConnect = vi
      .fn<() => Promise<LocalOpenCodeConnectResult>>()
      .mockResolvedValueOnce({ status: "failed", message: "Startup timed out." })
      .mockResolvedValue({
        status: "connected",
        connection: { serverUrl: "http://127.0.0.1:4096", password: "local-secret" },
      });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { host, dispose } = mount(
      makeDesktop({ load: () => Promise.resolve(undefined), connectLocal: localConnect }),
    );
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Startup timed out.");
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Retry");
    host.querySelector<HTMLButtonElement>("button")?.click();
    await flush();
    handshake.connect();
    await flush();
    expect(localConnect).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="connected"]')).not.toBeNull();
    dispose();
  });

  it("allows manual remote connection, retry, and forgetting through Change server", async () => {
    const desktop = makeDesktop({ load: () => Promise.resolve(undefined) });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { host, renderer, dispose } = mount(desktop);
    await flush();
    handshake.connect();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="change-server"]')?.click();
    await flush();
    host.querySelector<HTMLInputElement>('input[type="radio"][value="remote"]')?.click();
    const url = host.querySelector<HTMLInputElement>('input[autocomplete="url"]')!;
    url.value = "http://remote.test:4096";
    url.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    password.value = "remote-secret";
    password.dispatchEvent(new InputEvent("input", { bubbles: true }));
    verifyServer.mockRejectedValueOnce(new Error("offline"));
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    verifyServer.mockResolvedValue({ serverUrl: "http://remote.test:4096" });
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();
    expect(verifyServer).toHaveBeenLastCalledWith(
      { serverUrl: "http://remote.test:4096", password: "remote-secret" },
      expect.any(AbortSignal),
    );
    handshake.connect();
    await flush();
    expect(desktop.target.saveRemote).toHaveBeenCalledWith({
      serverUrl: "http://remote.test:4096",
      password: "remote-secret",
    });
    renderer.connection.changeServer();
    await flush();
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="url"]')?.value).toBe(
      "http://remote.test:4096",
    );
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Forget saved choice")
      ?.click();
    await flush();
    expect(desktop.target.clear).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Saved choice");
    dispose();
  });

  it("saves a passwordless remote endpoint without inventing a credential", async () => {
    const desktop = makeDesktop({ load: () => Promise.resolve(undefined) });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { renderer, dispose } = mount(desktop);
    await flush();
    handshake.connect();
    await flush();
    renderer.connection.changeServer();
    verifyServer.mockResolvedValue({ serverUrl: "http://remote.test" });
    renderer.connection.connect("remote", { serverUrl: "http://remote.test", password: "" });
    await flush();
    handshake.connect();
    await flush();
    expect(desktop.target.saveRemote).toHaveBeenCalledWith({ serverUrl: "http://remote.test" });
    dispose();
  });

  it("keeps a failed Forget in the server chooser instead of showing startup recovery", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      clear: () => Promise.reject(new Error("write failed")),
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { host, renderer, dispose } = mount(desktop);
    await flush();
    handshake.connect();
    await flush();
    renderer.connection.changeServer();
    await flush();
    renderer.connection.forget();
    await flush();
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector('[aria-label="OpenCode startup"]')).toBeNull();
    expect(host.textContent).toContain("The saved connection could not be forgotten");
    expect(host.textContent).toContain("Forget saved choice");
    dispose();
  });

  it("reports a local startup failure without a renderer process-stop request", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: () =>
        Promise.resolve({
          status: "failed",
          message: "The built-in OpenCode server failed to start.",
        }),
    });
    const { host, dispose } = mount(desktop);
    await flush();

    expect(host.textContent).toContain("The built-in OpenCode server failed to start.");
    expect(Object.keys(desktop.localOpenCode)).not.toContain("disconnect");
    dispose();
  });

  it("aborts verification after a crash and restarts only on an explicit action", async () => {
    let unavailable: (() => void) | undefined;
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>().mockResolvedValue({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "local-secret" },
    });
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: localConnect,
      onUnavailable: (listener) => {
        unavailable = listener;
        return () => undefined;
      },
    });
    verifyServer.mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const { host, dispose } = mount(desktop);
    await flush();
    const signal = verifyServer.mock.calls[0]?.[1];

    unavailable?.();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(host.textContent).toContain("The built-in OpenCode server stopped");
    expect(host.querySelector("button")?.textContent).toBe("Restart");
    expect(localConnect).toHaveBeenCalledOnce();
    host.querySelector<HTMLButtonElement>("button")?.click();
    await flush();
    expect(localConnect).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("keeps a remote connection intact when the unused built-in runtime crashes", async () => {
    let unavailable: (() => void) | undefined;
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({ kind: "remote", serverUrl: "http://remote.test", password: "secret" }),
      onUnavailable: (listener) => {
        unavailable = listener;
        return () => undefined;
      },
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://remote.test" });
    const { host, renderer, dispose } = mount(desktop);
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
    await flush();
    renderer.connection.changeServer();
    renderer.connection.connect("remote", { serverUrl: "http://remote.test", password: "secret" });
    await flush();
    handshake.connect();
    await flush();
    unavailable?.();
    await flush();
    expect(host.querySelector('[data-testid="connected"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(verifyServer.mock.calls[1]?.[1]?.aborted).toBe(false);
    host.querySelector<HTMLButtonElement>('[data-testid="change-server"]')?.click();
    host.querySelector<HTMLInputElement>('input[type="radio"][value="local"]')?.click();
    expect(host.querySelector(".connection-form-submit")?.textContent).toBe("Restart");
    dispose();
  });

  it("changes away from built-in and forgets its choice without requesting a process stop", async () => {
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>().mockResolvedValue({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "secret" },
    });
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: localConnect,
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://127.0.0.1:4096" });
    const { host, dispose } = mount(desktop);
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="change-server"]')?.click();
    await flush();
    expect(host.textContent).toContain("Start built-in server");
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Forget saved choice")
      ?.click();
    await flush();
    expect(desktop.target.clear).toHaveBeenCalledOnce();
    expect(Object.keys(desktop.localOpenCode)).toEqual(["connect", "onUnavailable"]);
    expect(localConnect).toHaveBeenCalledOnce();
    dispose();
  });

  it("aborts outstanding verification on unmount and ignores its late result", async () => {
    const verification = deferred<{ readonly serverUrl: string }>();
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({ kind: "remote", serverUrl: "http://remote.test", password: "secret" }),
    });
    verifyServer.mockReturnValue(verification.promise);
    const { dispose } = mount(desktop);
    await flush();
    const signal = verifyServer.mock.calls[0]?.[1];
    dispose();
    expect(signal?.aborted).toBe(true);
    verification.resolve({ serverUrl: "http://remote.test" });
    await flush();
    expect(desktop.target.saveLocal).not.toHaveBeenCalled();
  });

  it("ignores a late built-in start result after renderer unmount", async () => {
    const started = deferred<LocalOpenCodeConnectResult>();
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      connectLocal: () => started.promise,
    });
    const { dispose } = mount(desktop);
    await flush();
    dispose();
    started.resolve({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "secret" },
    });
    await flush();
    expect(verifyServer).not.toHaveBeenCalled();
  });
  it("keeps the SDK root when the workspace view is removed", async () => {
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({
          kind: "remote",
          serverUrl: "http://remote.test",
          password: "secret",
        }),
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://remote.test" });
    const { renderer, disposeView, host } = mount(desktop);
    await flush();
    const model = renderer.registry.get(renderer.connection.state).workspace?.model;
    disposeView();
    expect(handshake.disposed).not.toHaveBeenCalled();
    handshake.connect();
    await flush();
    expect(desktop.target.saveLocal).toHaveBeenCalledOnce();
    const disposeRemount = render(
      () => (
        <RegistryContext.Provider value={renderer.registry}>
          <App renderer={renderer} />
        </RegistryContext.Provider>
      ),
      host,
    );
    expect(renderer.registry.get(renderer.connection.state).workspace?.model).toBe(model);
    expect(host.querySelector('[data-testid="connected"]')).not.toBeNull();
    disposeRemount();
    await renderer.dispose();
    expect(handshake.disposed).toHaveBeenCalledOnce();
  });

  it("shows startup recovery after initial stream or location readiness fails", async () => {
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({
          kind: "remote",
          serverUrl: "http://remote.test",
          password: "secret",
        }),
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://remote.test" });
    const { host, dispose } = mount(desktop);
    await flush();
    handshake.fail(new Error("readiness failed"));
    await flush();
    expect(host.querySelector('[data-testid="connected"]')).toBeNull();
    expect(host.textContent).toContain("The built-in OpenCode server is unavailable");
    expect(desktop.target.saveLocal).not.toHaveBeenCalled();
    expect(handshake.disposed).toHaveBeenCalledOnce();
    dispose();
  });

  it("retains accepted local IPC until settlement when the renderer closes", async () => {
    const local = deferred<LocalOpenCodeConnectResult>();
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      connectLocal: () => local.promise,
    });
    const { renderer, disposeView } = mount(desktop);
    await flush();
    disposeView();
    let closed = false;
    const closing = renderer.dispose().then(() => {
      closed = true;
      return undefined;
    });
    await flush();
    expect(closed).toBe(false);
    local.resolve({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "secret" },
    });
    await closing;
    expect(verifyServer).not.toHaveBeenCalled();
  });
  it("settles workspace cleanup before the latest replacement can verify", async () => {
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({
          kind: "remote",
          serverUrl: "http://first.test",
          password: "secret",
        }),
    });
    verifyServer.mockResolvedValue({ serverUrl: "http://first.test" });
    const { renderer, dispose } = mount(desktop);
    await flush();
    handshake.connect();
    await flush();
    const workspace = renderer.registry.get(renderer.connection.state).workspace!;
    const helper = deferred();
    const pending = workspace.runtime.effects
      .runPromise(workspace.runtime.effects.request(() => helper.promise))
      .catch(() => undefined);
    renderer.connection.changeServer();
    renderer.connection.connect("remote", { serverUrl: "http://second.test", password: "" });
    renderer.connection.connect("remote", { serverUrl: "http://third.test", password: "" });
    await flush();
    expect(verifyServer).toHaveBeenCalledTimes(1);
    expect(handshake.disposed).not.toHaveBeenCalled();
    helper.resolve();
    await pending;
    await flush();
    expect(verifyServer).toHaveBeenCalledTimes(2);
    expect(verifyServer).toHaveBeenLastCalledWith(
      { serverUrl: "http://third.test", password: "" },
      expect.any(AbortSignal),
    );
    expect(handshake.disposed).toHaveBeenCalledOnce();
    dispose();
  });
});
