import { createSignal, onCleanup, type JSX } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { createShellPanelState, MOBILE_SHELL_MEDIA_QUERY } from "./createShellPanelState.ts";
import { ShellRegion } from "./ShellRegion.tsx";

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

type ShellOptions = {
  readonly mobile: boolean;
  readonly leftSidebarOpen?: boolean;
  readonly rightPanelOpen?: boolean;
  readonly sidebar?: JSX.Element;
  readonly context?: JSX.Element;
};

function mountShell(options: ShellOptions) {
  stubMatchMedia(options.mobile);
  let panels!: ReturnType<typeof createShellPanelState>;
  const mounted = mount(() => {
    panels = createShellPanelState({
      leftSidebarOpen: options.leftSidebarOpen,
      rightPanelOpen: options.rightPanelOpen,
    });
    return (
      <ShellRegion
        panels={panels}
        selectedTitle={() => "Review MCP requests"}
        sidebar={options.sidebar}
        main={<div data-testid="main">Transcript</div>}
        context={options.context}
      />
    );
  });
  return { panels, host: mounted.host, dispose: mounted.dispose };
}

afterEach(() => vi.unstubAllGlobals());

function CleanupProbe(props: { readonly onDispose: () => void }) {
  onCleanup(props.onDispose);
  return <div />;
}

describe("ShellRegion", () => {
  it("does not open either region when a panel flag has no slot", () => {
    const { host, dispose } = mountShell({
      mobile: false,
      leftSidebarOpen: true,
      rightPanelOpen: true,
    });

    const titlebar = host.querySelector<HTMLElement>(".shell-titlebar");
    const workspace = host.querySelector<HTMLElement>(".shell-workspace");
    if (!titlebar || !workspace) throw new Error("Shell regions did not render");

    expect(titlebar.classList.contains("left-sidebar-open")).toBe(false);
    expect(titlebar.classList.contains("right-panel-open")).toBe(false);
    expect(workspace.classList.contains("left-sidebar-open")).toBe(false);
    expect(workspace.classList.contains("right-panel-open")).toBe(false);
    expect(host.querySelector(".shell-left-sidebar")).toBeNull();
    expect(host.querySelector(".shell-right-panel")).toBeNull();
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="main"]')?.textContent).toBe("Transcript");
    expect(host.querySelector('[aria-label="Show sessions"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Show context"]')).not.toBeNull();

    dispose();
  });

  it("keeps the mobile titlebar interactive when a panel flag has no slot", () => {
    const { panels, host, dispose } = mountShell({ mobile: true });

    panels.setLeftSidebarOpen(true);
    expect(panels.leftSidebarOpen()).toBe(true);
    const titlebar = host.querySelector<HTMLElement>(".shell-titlebar");
    if (!titlebar) throw new Error("Shell titlebar did not render");
    expect(titlebar.getAttribute("aria-hidden")).toBeNull();
    expect(titlebar.inert).toBe(false);
    expect(host.querySelector(".shell-left-sidebar")).toBeNull();

    panels.setRightPanelOpen(true);
    expect(panels.rightPanelOpen()).toBe(true);
    expect(titlebar.getAttribute("aria-hidden")).toBeNull();
    expect(titlebar.inert).toBe(false);
    expect(host.querySelector(".shell-right-panel")).toBeNull();

    dispose();
  });

  it("shares effective visibility with both regions and resolves slots once", () => {
    stubMatchMedia(false);
    const resolutions = { sidebar: 0, main: 0, context: 0 };
    const [version, setVersion] = createSignal("first");
    const slot = (name: keyof typeof resolutions) => {
      resolutions[name] += 1;
      return <div>{version()}</div>;
    };
    let panels!: ReturnType<typeof createShellPanelState>;
    const { host, dispose } = mount(() => {
      panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
      return (
        <ShellRegion
          panels={panels}
          selectedTitle={() => "Review MCP requests"}
          sidebar={slot("sidebar")}
          main={slot("main")}
          context={slot("context")}
        />
      );
    });

    const titlebar = host.querySelector<HTMLElement>(".shell-titlebar");
    const workspace = host.querySelector<HTMLElement>(".shell-workspace");
    if (!titlebar || !workspace) throw new Error("Shell regions did not render");
    expect(titlebar.classList.contains("left-sidebar-open")).toBe(true);
    expect(titlebar.classList.contains("right-panel-open")).toBe(true);
    expect(workspace.classList.contains("left-sidebar-open")).toBe(true);
    expect(workspace.classList.contains("right-panel-open")).toBe(true);
    expect(resolutions).toEqual({ sidebar: 1, main: 1, context: 1 });

    setVersion("second");
    expect(workspace.textContent).toBe("secondsecondsecond");
    expect(resolutions).toEqual({ sidebar: 1, main: 1, context: 1 });

    panels.setLeftSidebarOpen(false);
    expect(titlebar.classList.contains("left-sidebar-open")).toBe(false);
    expect(workspace.classList.contains("left-sidebar-open")).toBe(false);
    panels.setRightPanelOpen(false);
    expect(titlebar.classList.contains("right-panel-open")).toBe(false);
    expect(workspace.classList.contains("right-panel-open")).toBe(false);
    panels.setLeftSidebarOpen(true);
    panels.setRightPanelOpen(true);
    expect(titlebar.classList.contains("left-sidebar-open")).toBe(true);
    expect(titlebar.classList.contains("right-panel-open")).toBe(true);
    expect(workspace.classList.contains("left-sidebar-open")).toBe(true);
    expect(workspace.classList.contains("right-panel-open")).toBe(true);
    expect(resolutions).toEqual({ sidebar: 1, main: 1, context: 1 });

    dispose();
  });

  it("keeps hidden panel slots alive until the shell disposes", () => {
    stubMatchMedia(false);
    const disposals = { sidebar: 0, main: 0, context: 0 };
    const probe = (name: keyof typeof disposals) => (
      <CleanupProbe onDispose={() => (disposals[name] += 1)} />
    );
    let panels!: ReturnType<typeof createShellPanelState>;
    const { host, dispose } = mount(() => {
      panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
      return (
        <ShellRegion
          panels={panels}
          selectedTitle={() => "Review MCP requests"}
          sidebar={probe("sidebar")}
          main={probe("main")}
          context={probe("context")}
        />
      );
    });

    const workspace = host.querySelector<HTMLElement>(".shell-workspace");
    if (!workspace) throw new Error("Shell workspace did not render");

    panels.setLeftSidebarOpen(false);
    panels.setRightPanelOpen(false);
    expect(workspace.textContent).toBe("");
    expect(disposals).toEqual({ sidebar: 0, main: 0, context: 0 });

    panels.setLeftSidebarOpen(true);
    panels.setRightPanelOpen(true);
    expect(disposals).toEqual({ sidebar: 0, main: 0, context: 0 });

    dispose();
    expect(disposals).toEqual({ sidebar: 1, main: 1, context: 1 });
  });
});
