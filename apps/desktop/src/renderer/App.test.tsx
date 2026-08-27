import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { DesktopApi, OpenCodeTarget } from "../shared/desktop-api.ts";
import type { VerifiedServer } from "./opencode/index.ts";

const verifyServer = vi.hoisted(() =>
  vi.fn<(input: { serverUrl: string; password: string }) => Promise<VerifiedServer>>(),
);

vi.mock("./opencode/index.ts", () => ({
  OpenCodeConnectionError: class extends Error {},
  ServerProvider: (props: { readonly children?: unknown }) => props.children,
  verifyServer,
}));

vi.mock("./components/App/ConnectedApp.tsx", () => ({
  ConnectedApp: () => null,
}));

import { App } from "./App.tsx";

type Deferred<A> = {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
  readonly reject: (cause: unknown) => void;
};

const deferred = <A,>(): Deferred<A> => {
  let resolvePromise: ((value: A) => void) | undefined;
  let rejectPromise: ((cause: unknown) => void) | undefined;
  const promise = new Promise<A>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (cause) => rejectPromise?.(cause),
  };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeDesktop = (options: {
  readonly load: () => Promise<OpenCodeTarget | undefined>;
  readonly clear?: () => Promise<void>;
  readonly connectLocal?: () => Promise<{ serverUrl: string; password: string }>;
  readonly onUnavailable?: (listener: () => void) => () => void;
}): DesktopApi => ({
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
      vi.fn<() => Promise<{ serverUrl: string; password: string }>>(() =>
        Promise.reject(new Error("not configured")),
      ),
    disconnect: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    onUnavailable: options.onUnavailable ?? (() => () => undefined),
  },
});

const mount = (desktop: DesktopApi) => {
  Object.defineProperty(window, "desktop", { configurable: true, value: desktop });
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  return { host, dispose };
};

afterEach(() => {
  verifyServer.mockReset();
  document.body.replaceChildren();
});

describe("App target startup", () => {
  it("does not let a late saved target replace a manual connection", async () => {
    const loaded = deferred<OpenCodeTarget | undefined>();
    const localConnect = vi.fn<() => Promise<{ serverUrl: string; password: string }>>();
    verifyServer.mockImplementation(() => new Promise(() => undefined));
    const desktop = makeDesktop({ load: () => loaded.promise, connectLocal: localConnect });
    const { host, dispose } = mount(desktop);

    const inputs = host.querySelectorAll("input");
    const urlInput = inputs.item(0);
    const passwordInput = inputs.item(1);
    urlInput.value = "http://remote.test:4096";
    urlInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    passwordInput.value = "remote-secret";
    passwordInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();

    loaded.resolve({ kind: "local" });
    await flush();
    expect(verifyServer).toHaveBeenCalledWith({
      serverUrl: "http://remote.test:4096",
      password: "remote-secret",
    });
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

    expect(verifyServer).toHaveBeenCalledWith({
      serverUrl: "http://remote.test:4096",
      password: "saved-secret",
    });
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    await flush();
    expect(verifyServer).toHaveBeenLastCalledWith({
      serverUrl: "http://remote.test:4096",
      password: "saved-secret",
    });
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
      (button) => button.textContent?.trim() === "Forget saved connection",
    );
    forget?.click();
    await flush();
    expect(host.textContent).toContain("The saved connection could not be forgotten");
    dispose();
  });

  it("keeps a saved local target forgettable when startup fails", async () => {
    const desktop = makeDesktop({
      load: () => Promise.resolve({ kind: "local" }),
      connectLocal: () => Promise.reject(new Error("failed")),
    });
    const { host, dispose } = mount(desktop);
    await flush();
    await flush();

    expect(host.textContent).toContain("Forget saved connection");
    dispose();
  });

  it("stops the owned sidecar when it becomes unavailable", async () => {
    let unavailable: (() => void) | undefined;
    const desktop = makeDesktop({
      load: () => Promise.resolve(undefined),
      connectLocal: () =>
        Promise.resolve({ serverUrl: "http://127.0.0.1:4096", password: "local-secret" }),
      onUnavailable: (listener) => {
        unavailable = listener;
        return () => undefined;
      },
    });
    verifyServer.mockImplementation(() => new Promise(() => undefined));
    const { dispose } = mount(desktop);
    await flush();

    unavailable?.();
    await flush();
    expect(desktop.localOpenCode.disconnect).toHaveBeenCalledOnce();
    dispose();
  });
});
