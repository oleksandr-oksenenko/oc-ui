import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { createShellPanelState, MOBILE_SHELL_MEDIA_QUERY } from "./createShellPanelState.ts";

function mountState(options?: { leftSidebarOpen?: boolean; rightPanelOpen?: boolean }) {
  let state!: ReturnType<typeof createShellPanelState>;
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => {
    state = createShellPanelState(options);
    return <div />;
  }, host);
  return { state, dispose, host };
}

describe("createShellPanelState", () => {
  it("initializes mobile state from matchMedia", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: MOBILE_SHELL_MEDIA_QUERY,
        addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.delete(listener),
      })),
    );
    const mounted = mountState({ leftSidebarOpen: true, rightPanelOpen: true });

    expect(mounted.state.mobile()).toBe(true);
    expect(mounted.state.leftSidebarOpen()).toBe(false);
    expect(mounted.state.rightPanelOpen()).toBe(false);
    mounted.dispose();
    mounted.host.remove();
    vi.unstubAllGlobals();
  });

  it("keeps mobile overlays mutually exclusive", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: MOBILE_SHELL_MEDIA_QUERY,
        addEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
        removeEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
      })),
    );
    const mounted = mountState();
    mounted.state.setLeftSidebarOpen(true);
    expect(mounted.state.leftSidebarOpen()).toBe(true);
    expect(mounted.state.rightPanelOpen()).toBe(false);
    mounted.state.toggleRightPanel();
    expect(mounted.state.leftSidebarOpen()).toBe(false);
    expect(mounted.state.rightPanelOpen()).toBe(true);
    mounted.dispose();
    mounted.host.remove();
    vi.unstubAllGlobals();
  });

  it("closes an open mobile overlay with Escape", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: MOBILE_SHELL_MEDIA_QUERY,
        addEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
        removeEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
      })),
    );
    const mounted = mountState();
    mounted.state.setRightPanelOpen(true);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(mounted.state.leftSidebarOpen()).toBe(false);
    expect(mounted.state.rightPanelOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    mounted.dispose();
    mounted.host.remove();
    vi.unstubAllGlobals();
  });

  it("preserves desktop panel options", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: MOBILE_SHELL_MEDIA_QUERY,
        addEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
        removeEventListener:
          vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
      })),
    );
    const mounted = mountState({ leftSidebarOpen: true, rightPanelOpen: true });
    expect(mounted.state.mobile()).toBe(false);
    expect(mounted.state.leftSidebarOpen()).toBe(true);
    expect(mounted.state.rightPanelOpen()).toBe(true);
    mounted.dispose();
    mounted.host.remove();
    vi.unstubAllGlobals();
  });
});
