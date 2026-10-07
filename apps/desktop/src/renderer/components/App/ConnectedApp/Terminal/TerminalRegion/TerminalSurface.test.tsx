import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ResttyConfig } from "restty";
import { Effect, Predicate } from "effect";

import type { TerminalSessions } from "../../../../../opencode/terminal-sessions.ts";
import { deferred } from "../../../../../test/deferred.ts";
import { mount } from "../../../../../test/mount.ts";
import { withTestWorkspace } from "../../../../../test/workspace.ts";
import { stubResizeObserver } from "../../../../../test/resize-observer.ts";
import { TerminalSurface, type TerminalSurfaceProps } from "./TerminalSurface.tsx";
import { WorkspaceRequestError } from "../../../../../workspace-owner.ts";
import { ThemeProvider } from "../../../../../ui/ThemeProvider.tsx";
import type { Theme } from "../../../../../appearance.ts";

const renderer = vi.hoisted(() => ({
  init: vi.fn<() => Promise<void>>(),
  destroy: vi.fn<() => void>(),
  connect: vi.fn<(url: string) => void>(),
  pause: vi.fn<(paused: boolean) => void>(),
  focus: vi.fn<() => void>(),
  constructed: vi.fn<(config: ResttyConfig) => void>(),
  applyTheme: vi.fn<() => void>(),
  size: vi.fn<() => void>(),
}));
vi.mock("restty", () => ({
  parseGhosttyTheme: () => ({ colors: { palette: [] }, raw: {} }),
  Restty: class {
    readonly container = document.createElement("div");
    readonly input = document.createElement("textarea");
    constructor(config: ResttyConfig) {
      Object.defineProperties(config.root, {
        clientWidth: { configurable: true, get: () => (config.root.closest("[hidden]") ? 0 : 800) },
        clientHeight: {
          configurable: true,
          get: () => (config.root.closest("[hidden]") ? 0 : 200),
        },
      });
      this.container.append(this.input, document.createElement("canvas"));
      config.root.append(this.container);
      renderer.constructed(config);
    }
    getActivePane() {
      return {
        container: this.container,
        canvas: document.createElement("canvas"),
        imeInput: document.createElement("textarea"),
        runtime: { lifecycle: { init: renderer.init } },
      };
    }
    getBackend() {
      return "webgl2";
    }
    connectPty = renderer.connect;
    setPaused = renderer.pause;
    focus = () => {
      renderer.focus();
      this.input.focus();
    };
    updateSize = renderer.size;
    applyTheme = renderer.applyTheme;
    destroy = renderer.destroy;
  },
}));

beforeEach(() => {
  stubResizeObserver();
  vi.clearAllMocks();
  renderer.init.mockResolvedValue();
});

const setup = (
  initialVisible = true,
  connected = () => true,
  fonts: TerminalSurfaceProps["fonts"] = Effect.succeed([]),
) =>
  withTestWorkspace((effects) => {
    const [visible, setVisible] = createSignal(initialVisible);
    const [theme, setTheme] = createSignal<Theme>("light");
    const controller: Pick<TerminalSessions, "transport"> = {
      transport: () => ({
        connect: () => undefined,
        disconnect: () => undefined,
        sendInput: () => true,
        resize: () => true,
        isConnected: connected,
      }),
    };
    const view = mount(() => (
      <ThemeProvider theme={theme}>
        <TerminalSurface
          id="terminal"
          controller={controller}
          fonts={fonts}
          effects={effects}
          serverUrl="https://server.test"
          visible={visible()}
        />
      </ThemeProvider>
    ));
    return { ...view, setVisible, setTheme };
  });

describe("TerminalSurface lifetime", () => {
  it("suppresses input instead of displaying undelivered commands while disconnected", async () => {
    let connected = false;
    const view = setup(true, () => connected);
    await expect.poll(() => renderer.connect.mock.calls.length).toBe(1);
    const services = renderer.constructed.mock.calls[0]?.[0].services;
    if (!services || Predicate.isFunction(services)) throw new Error("Expected transport services");
    const beforeInput = services.beforeInput;
    expect(beforeInput?.({ text: "dangerous command", source: "key" })).toBeNull();
    connected = true;
    expect(beforeInput?.({ text: "safe command", source: "key" })).toBe("safe command");
    connected = false;
    expect(beforeInput?.({ text: "paste", source: "paste" })).toBeNull();
    view.dispose();
  });
  it("defers background terminal initialization until its first visible layout", async () => {
    const view = setup(false);
    await Promise.resolve();
    expect(renderer.constructed).not.toHaveBeenCalled();
    expect(renderer.connect).not.toHaveBeenCalled();
    view.setVisible(true);
    await expect.poll(() => renderer.connect.mock.calls.length).toBe(1);
    view.dispose();
    await expect.poll(() => renderer.destroy.mock.calls.length).toBe(1);
  });
  it("pauses drawing without recreating the terminal when hidden and reopened", async () => {
    const view = setup();
    await expect.poll(() => renderer.connect.mock.calls.length).toBe(1);
    const surface = view.host.querySelector(".terminal-surface");
    view.setVisible(false);
    expect(surface?.hasAttribute("hidden")).toBe(true);
    expect(renderer.pause).toHaveBeenLastCalledWith(true);
    view.setVisible(true);
    expect(view.host.querySelector(".terminal-surface")).toBe(surface);
    expect(renderer.pause).toHaveBeenLastCalledWith(false);
    expect(renderer.constructed).toHaveBeenCalledOnce();
    expect(renderer.destroy).not.toHaveBeenCalled();
    view.dispose();
    await expect.poll(() => renderer.destroy.mock.calls.length).toBe(1);
  });

  it("retains initialization through disposal and never attaches its late renderer", async () => {
    const initialization = deferred();
    renderer.init.mockReturnValue(initialization.promise);
    const view = setup();
    await expect.poll(() => renderer.init.mock.calls.length).toBe(1);
    view.dispose();
    expect(renderer.destroy).not.toHaveBeenCalled();
    initialization.resolve();
    await expect.poll(() => renderer.destroy.mock.calls.length).toBe(1);
    expect(renderer.connect).not.toHaveBeenCalled();
    expect(renderer.focus).not.toHaveBeenCalled();
  });

  it("waits for visible geometry before attaching an initialization that completed while hidden", async () => {
    const initialization = deferred();
    renderer.init.mockReturnValue(initialization.promise);
    const view = setup();
    await expect.poll(() => renderer.init.mock.calls.length).toBe(1);
    view.setVisible(false);
    initialization.resolve();
    await expect
      .poll(() => view.host.querySelector(".terminal-surface")?.getAttribute("data-ready"))
      .toBe("true");
    expect(renderer.connect).not.toHaveBeenCalled();
    expect(renderer.size).not.toHaveBeenCalled();
    view.setVisible(true);
    expect(renderer.connect).toHaveBeenCalledOnce();
    expect(renderer.size.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.connect.mock.invocationCallOrder[0]!,
    );
    view.setVisible(false);
    view.setVisible(true);
    expect(renderer.connect).toHaveBeenCalledOnce();
    expect(renderer.constructed).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("destroys a failed renderer and presents its initialization error", async () => {
    renderer.init.mockRejectedValue(new Error("Font loading failed"));
    const view = setup();
    await expect
      .poll(() => view.host.querySelector('[role="alert"] > span')?.textContent)
      .toBe("Font loading failed");
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(renderer.connect).not.toHaveBeenCalled();
    view.dispose();
  });

  it("does not move focus from tabs on activation or from the composer on theme changes", async () => {
    const view = setup();
    await expect.poll(() => renderer.connect.mock.calls.length).toBe(1);
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    const composer = document.createElement("textarea");
    view.host.append(tab, composer);
    tab.focus();
    view.setVisible(false);
    view.setVisible(true);
    expect(document.activeElement).toBe(tab);
    composer.focus();
    view.setTheme("dark");
    expect(renderer.applyTheme).toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
    expect(renderer.focus).not.toHaveBeenCalled();
    view.dispose();
  });

  it("retries failed font initialization on the same PTY and focuses only explicit terminal actions", async () => {
    let loads = 0;
    const fonts = Effect.suspend(() => {
      loads += 1;
      return loads === 1
        ? Effect.fail(new WorkspaceRequestError({ cause: new Error("Font asset unavailable") }))
        : Effect.succeed([]);
    });
    const view = setup(true, () => true, fonts);
    await expect
      .poll(() => view.host.querySelector('[aria-label="Retry terminal renderer"]'))
      .not.toBeNull();
    const surface = view.host.querySelector(".terminal-surface");
    const retry = view.host.querySelector<HTMLButtonElement>(
      '[aria-label="Retry terminal renderer"]',
    )!;
    retry.focus();
    retry.click();
    await expect.poll(() => renderer.connect.mock.calls.length).toBe(1);
    expect(loads).toBe(2);
    expect(view.host.querySelector(".terminal-surface")).toBe(surface);
    expect(surface?.getAttribute("data-terminal-id")).toBe("terminal");
    expect(surface?.getAttribute("data-ready")).toBe("true");
    expect(renderer.constructed).toHaveBeenCalledOnce();
    expect(renderer.destroy).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Terminal input");
    // Retry removes its loading control; reopening is another explicit focus action.
    view.setVisible(false);
    const show = document.createElement("button");
    show.setAttribute("data-terminal-focus", "");
    view.host.append(show);
    show.focus();
    view.setVisible(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Terminal input");
    view.dispose();
  });
});
