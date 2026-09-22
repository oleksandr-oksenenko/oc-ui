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
  createWorkspaceModel: () => ({}),
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
        Promise.reject(new Error("not configured")),
      ),
    onUnavailable: options.onUnavailable ?? (() => () => undefined),
  },
  clipboard: {
    readText: vi.fn<() => Promise<string>>(() => Promise.resolve("")),
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
  it("waits for a first-run choice instead of starting the built-in server", async () => {
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>();
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      connectLocal: localConnect,
    });
    const { host, dispose } = mount(desktop);
    await flush();

    expect(localConnect).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Start built-in server");
    expect(host.textContent).not.toContain("Saved choice");
    dispose();
  });

  it("preselects a saved local choice without starting and saves only after explicit startup", async () => {
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>().mockResolvedValue({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "local-secret" },
    });
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: localConnect,
    });
    verifyServer.mockResolvedValue({
      serverUrl: "http://127.0.0.1:4096",
    });
    const { host, dispose } = mount(desktop);
    await flush();
    expect(localConnect).not.toHaveBeenCalled();
    expect(verifyServer).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Saved choice");
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
    await flush();

    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
    await flush();
    expect(desktop.target.saveLocal).toHaveBeenCalledOnce();
    expect(desktop.target.saveRemote).not.toHaveBeenCalled();
    dispose();
  });

  it("saves a passwordless remote endpoint without inventing a credential", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "remote", serverUrl: "http://remote.test:4096" }),
    });
    verifyServer.mockResolvedValue({
      serverUrl: "http://remote.test:4096",
    });
    const { host, dispose } = mount(desktop);
    await flush();

    expect(verifyServer).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="url"]')?.value).toBe(
      "http://remote.test:4096",
    );
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
    await flush();

    expect(desktop.target.saveRemote).toHaveBeenCalledWith({
      serverUrl: "http://remote.test:4096",
    });
    dispose();
  });

  it("keeps the saved remote endpoint visible when changing servers", async () => {
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({
          kind: "remote",
          serverUrl: "http://remote.test:4096",
          password: "saved-secret",
        }),
    });
    verifyServer.mockResolvedValue({
      serverUrl: "http://remote.test:4096",
    });
    const { host, dispose } = mount(desktop);
    await flush();
    await flush();

    host.querySelector<HTMLButtonElement>('[data-testid="change-server"]')?.click();
    await flush();
    expect(host.textContent).toContain("Saved choice");
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="url"]')?.value).toBe(
      "http://remote.test:4096",
    );
    dispose();
  });

  it("does not let a late saved target replace a manual connection", async () => {
    const loaded = deferred<OpenCodeTarget | undefined>();
    const localConnect = vi.fn<() => Promise<LocalOpenCodeConnectResult>>();
    verifyServer.mockImplementation(() => new Promise(() => undefined));
    const desktop = makeDesktop({ load: () => loaded.promise, connectLocal: localConnect });
    const { host, dispose } = mount(desktop);

    host.querySelector<HTMLInputElement>('input[type="radio"][value="remote"]')?.click();
    const urlInput = host.querySelector<HTMLInputElement>('input[autocomplete="url"]')!;
    const passwordInput = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    urlInput.value = "http://remote.test:4096";
    urlInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    passwordInput.value = "remote-secret";
    passwordInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();

    loaded.resolve({ kind: "local" });
    await flush();
    expect(verifyServer).toHaveBeenCalledWith(
      { serverUrl: "http://remote.test:4096", password: "remote-secret" },
      expect.any(AbortSignal),
    );
    expect(localConnect).not.toHaveBeenCalled();
    dispose();
  });

  it("retries a saved remote password without rendering it into the form", async () => {
    let verification = 0;
    verifyServer.mockImplementation(() => {
      verification += 1;
      return verification === 1
        ? Promise.reject(new Error("temporarily unavailable"))
        : new Promise(() => undefined);
    });
    const desktop = makeDesktop({
      load: () =>
        Promise.resolve({
          kind: "remote",
          serverUrl: "http://remote.test:4096",
          password: "saved-secret",
        }),
    });
    const { host, dispose } = mount(desktop);
    await flush();
    await flush();

    expect(verifyServer).toHaveBeenCalledWith(
      { serverUrl: "http://remote.test:4096", password: "saved-secret" },
      expect.any(AbortSignal),
    );
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();
    expect(verifyServer).toHaveBeenLastCalledWith(
      { serverUrl: "http://remote.test:4096", password: "saved-secret" },
      expect.any(AbortSignal),
    );
    expect(verifyServer).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("reports a saved-target clear failure", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "remote", serverUrl: "http://remote.test:4096" }),
      clear: () => Promise.reject(new Error("write failed")),
    });
    const { host, dispose } = mount(desktop);
    await flush();

    const forget = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Forget saved choice",
    );
    forget?.click();
    await flush();
    expect(host.textContent).toContain("The saved connection could not be forgotten");
    dispose();
  });

  it("keeps a saved local target forgettable when startup fails", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: () =>
        Promise.resolve({
          status: "failed",
          message: "The built-in OpenCode server did not start before the startup timeout.",
        }),
    });
    const { host, dispose } = mount(desktop);
    await flush();
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
    await flush();

    expect(host.textContent).toContain("Forget saved choice");
    expect(host.textContent).toContain(
      "The built-in OpenCode server did not start before the startup timeout.",
    );
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
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
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
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
    await flush();
    const signal = verifyServer.mock.calls[0]?.[1];

    unavailable?.();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(host.textContent).toContain("The built-in OpenCode server stopped");
    expect(host.querySelector(".connection-form-submit")?.textContent).toBe("Restart");
    expect(localConnect).toHaveBeenCalledOnce();
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
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
    const { host, dispose } = mount(desktop);
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
    unavailable?.();
    await flush();
    expect(host.querySelector('[data-testid="connected"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(verifyServer.mock.calls[0]?.[1]?.aborted).toBe(false);
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
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
    await flush();
    host.querySelector<HTMLButtonElement>('[data-testid="connected"]')?.click();
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
    expect(desktop.target.saveRemote).not.toHaveBeenCalled();
  });

  it("ignores a late built-in start result after renderer unmount", async () => {
    const started = deferred<LocalOpenCodeConnectResult>();
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      connectLocal: () => started.promise,
    });
    const { host, dispose } = mount(desktop);
    await flush();
    host.querySelector<HTMLButtonElement>(".connection-form-submit")?.click();
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
    expect(desktop.target.saveRemote).toHaveBeenCalledOnce();
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

  it("returns to selection after initial stream or location readiness fails", async () => {
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
    expect(host.textContent).toContain("The OpenCode server connection could not be set up");
    expect(desktop.target.saveRemote).not.toHaveBeenCalled();
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
    renderer.connection.connect("local");
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
