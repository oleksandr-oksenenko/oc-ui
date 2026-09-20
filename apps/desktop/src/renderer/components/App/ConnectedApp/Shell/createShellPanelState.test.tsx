import { batch, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { createMemorySessionPanelStorage } from "../../../../test/session-panel-storage.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createShellPanelState, MOBILE_SHELL_MEDIA_QUERY } from "./createShellPanelState.ts";
import { createSessionPanelLayouts } from "./sessionPanelLayouts.ts";

function mountState(options?: { leftSidebarOpen?: boolean; rightPanelOpen?: boolean }) {
  let state!: ReturnType<typeof createShellPanelState>;
  const { host, dispose } = mount(() => {
    state = createShellPanelState(options);
    return <div />;
  });
  return { state, dispose, host };
}

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: MOBILE_SHELL_MEDIA_QUERY,
      addEventListener:
        vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
      removeEventListener:
        vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(),
    })),
  );
}

/** A media query stand-in whose match state can change during a test. */
function stubChangeableMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: MOBILE_SHELL_MEDIA_QUERY,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

function mountSessionState(options: {
  readonly selected?: string;
  readonly values?: Map<string, string>;
}) {
  const memory = createMemorySessionPanelStorage(options.values);
  let state!: ReturnType<typeof createShellPanelState>;
  const mounted = withTestWorkspace((effects) => {
    const layouts = createSessionPanelLayouts({ effects, storage: memory.storage });
    const [selectedID, setSelectedID] = createSignal<string | undefined>(options.selected);
    const dom = mount(() => {
      state = createShellPanelState({ selectedID, layouts });
      return <div />;
    });
    return { dom, layouts, select: setSelectedID };
  });
  return {
    state,
    layouts: mounted.layouts,
    select: mounted.select,
    values: memory.values,
    dispose: () => mounted.dom.dispose(),
  };
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
    vi.unstubAllGlobals();
  });

  it("keeps mobile overlays mutually exclusive", () => {
    stubMatchMedia(true);
    const mounted = mountState();
    mounted.state.setLeftSidebarOpen(true);
    expect(mounted.state.leftSidebarOpen()).toBe(true);
    expect(mounted.state.rightPanelOpen()).toBe(false);
    mounted.state.toggleRightPanel();
    expect(mounted.state.leftSidebarOpen()).toBe(false);
    expect(mounted.state.rightPanelOpen()).toBe(true);
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("closes an open mobile overlay with Escape", () => {
    stubMatchMedia(true);
    const mounted = mountState();
    mounted.state.setRightPanelOpen(true);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(mounted.state.leftSidebarOpen()).toBe(false);
    expect(mounted.state.rightPanelOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("preserves desktop panel options", () => {
    stubMatchMedia(false);
    const mounted = mountState({ leftSidebarOpen: true, rightPanelOpen: true });
    expect(mounted.state.mobile()).toBe(false);
    expect(mounted.state.leftSidebarOpen()).toBe(true);
    expect(mounted.state.rightPanelOpen()).toBe(true);
    mounted.dispose();
    vi.unstubAllGlobals();
  });
});

describe("createShellPanelState per-session context panel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the open state and view per session", () => {
    stubMatchMedia(false);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setContextView("browser");
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.contextView()).toBe("browser");
    expect(fixture.state.rightPanelOpen()).toBe(true);

    fixture.select("b");
    expect(fixture.state.rightPanelOpen()).toBe(false);
    expect(fixture.state.contextView()).toBe("diff");

    fixture.select("a");
    expect(fixture.state.rightPanelOpen()).toBe(true);
    expect(fixture.state.contextView()).toBe("browser");

    // Closing keeps the session's view for the next open.
    fixture.state.setRightPanelOpen(false);
    expect(fixture.state.rightPanelOpen()).toBe(false);
    expect(fixture.state.contextView()).toBe("browser");
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(true);
    fixture.dispose();
  });

  it("persists records across workspace instances", () => {
    stubMatchMedia(false);
    const values = new Map<string, string>();
    const first = mountSessionState({ selected: "a", values });
    first.state.setContextView("browser");
    first.state.setRightPanelOpen(true);
    first.dispose();

    const second = mountSessionState({ selected: "a", values });
    expect(second.state.contextView()).toBe("browser");
    expect(second.state.rightPanelOpen()).toBe(true);
    second.dispose();
  });

  it("keeps no-session toggles out of session records", () => {
    stubMatchMedia(false);
    const fixture = mountSessionState({});
    fixture.state.setRightPanelOpen(true);
    fixture.state.setContextView("browser");
    expect(fixture.state.rightPanelOpen()).toBe(true);
    expect(fixture.state.contextView()).toBe("browser");

    fixture.select("a");
    expect(fixture.state.rightPanelOpen()).toBe(false);
    expect(fixture.state.contextView()).toBe("diff");
    expect(fixture.values.size).toBe(0);
    fixture.dispose();
  });

  it("writes the newly selected session when the panel opens in the same update", () => {
    stubMatchMedia(false);
    const fixture = mountSessionState({ selected: "a" });
    fixture.select("b");
    fixture.state.setContextView("browser");
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(true);
    expect(fixture.state.contextView()).toBe("browser");

    fixture.select("a");
    expect(fixture.state.rightPanelOpen()).toBe(false);
    expect(fixture.state.contextView()).toBe("diff");
    fixture.select("b");
    expect(fixture.state.rightPanelOpen()).toBe(true);
    fixture.dispose();
  });

  it("hides a stored-open panel on a narrow layout and restores it wide", () => {
    const media = stubChangeableMatchMedia(false);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(true);

    media.set(true);
    expect(fixture.state.mobile()).toBe(true);
    expect(fixture.state.rightPanelOpen()).toBe(false);

    media.set(false);
    expect(fixture.state.rightPanelOpen()).toBe(true);
    fixture.dispose();
  });

  it("does not overwrite stored state from narrow forced closes", () => {
    stubChangeableMatchMedia(true);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(fixture.state.rightPanelOpen()).toBe(false);
    expect(fixture.layouts.layout("a").open).toBe(true);
    fixture.dispose();
  });

  it("starts each narrow selection visit closed and does not resurrect an old overlay", () => {
    const media = stubChangeableMatchMedia(true);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(true);

    fixture.select("b");
    expect(fixture.state.rightPanelOpen()).toBe(false);
    fixture.select("a");
    expect(fixture.state.rightPanelOpen()).toBe(false);

    media.set(false);
    expect(fixture.state.rightPanelOpen()).toBe(true);
    fixture.dispose();
  });

  it("keeps an overlay opened for the new narrow selection in the same update", () => {
    stubChangeableMatchMedia(true);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);

    batch(() => {
      fixture.select("b");
      fixture.state.setContextView("browser");
      fixture.state.setRightPanelOpen(true);
    });

    expect(fixture.state.rightPanelOpen()).toBe(true);
    expect(fixture.state.contextView()).toBe("browser");
    expect(fixture.layouts.layout("b")).toEqual({ open: true, view: "browser" });
    expect(fixture.layouts.layout("a")).toEqual({ open: true, view: "diff" });
    fixture.dispose();
  });

  it("does not resurrect a narrow overlay after a selection gap", () => {
    stubChangeableMatchMedia(true);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);

    fixture.select(undefined);
    expect(fixture.state.rightPanelOpen()).toBe(false);
    fixture.select("a");
    expect(fixture.state.rightPanelOpen()).toBe(false);
    fixture.dispose();
  });

  it("closes the context overlay without writing when the sessions overlay opens", () => {
    const media = stubChangeableMatchMedia(true);
    const fixture = mountSessionState({ selected: "a" });
    fixture.state.setRightPanelOpen(true);
    fixture.state.setLeftSidebarOpen(true);
    expect(fixture.state.rightPanelOpen()).toBe(false);

    media.set(false);
    expect(fixture.state.rightPanelOpen()).toBe(true);
    fixture.dispose();
  });
});
