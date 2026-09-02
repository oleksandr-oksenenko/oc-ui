import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { Titlebar } from "./Titlebar.tsx";

describe("Titlebar", () => {
  it("keeps global controls visible without replacing the context controls", () => {
    const host = document.createElement("div");
    const [rightPanelOpen, setRightPanelOpen] = createSignal(true);
    document.body.append(host);
    const dispose = render(
      () => (
        <Titlebar
          selectedTitle="Open session"
          globalControls={<span data-testid="global-controls">Global requests</span>}
          rightControls={<span data-testid="right-controls">Context tabs</span>}
          leftSidebarOpen={false}
          rightPanelOpen={rightPanelOpen()}
          rightPanelAvailable
          onToggleLeftSidebar={() => undefined}
          onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
        />
      ),
      host,
    );

    expect(host.querySelector('[data-testid="global-controls"]')?.textContent).toBe(
      "Global requests",
    );
    expect(host.querySelector('[data-testid="right-controls"]')?.textContent).toBe("Context tabs");

    setRightPanelOpen(false);

    expect(host.querySelector('[data-testid="global-controls"]')?.textContent).toBe(
      "Global requests",
    );
    expect(host.querySelector('[data-testid="right-controls"]')).toBeNull();
    expect(host.querySelector('[aria-label="Show context"]')).not.toBeNull();

    dispose();
    host.remove();
  });

  it("keeps mobile titlebar content inert while an overlay is open", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Titlebar
          mobile
          selectedTitle="Open session"
          globalControls={<span data-testid="global-controls">Global requests</span>}
          leftSidebarOpen
          rightPanelOpen={false}
          rightPanelAvailable={false}
          onToggleLeftSidebar={() => undefined}
          onToggleRightPanel={() => undefined}
        />
      ),
      host,
    );

    const titlebar = host.querySelector<HTMLElement>(".shell-titlebar");
    expect(titlebar?.getAttribute("aria-hidden")).toBe("true");
    expect(titlebar?.inert).toBe(true);
    expect(host.querySelector('[data-testid="global-controls"]')?.textContent).toBe(
      "Global requests",
    );

    dispose();
    host.remove();
  });

  it("restores focus to the mobile sessions trigger after the overlay closes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(false);
    const dispose = render(
      () => (
        <Titlebar
          mobile
          selectedTitle="Responsive session"
          leftSidebarOpen={leftSidebarOpen()}
          rightPanelOpen={false}
          rightPanelAvailable={false}
          onToggleLeftSidebar={() => setLeftSidebarOpen(true)}
          onToggleRightPanel={() => undefined}
        />
      ),
      host,
    );

    host.querySelector<HTMLButtonElement>('[aria-label="Show sessions"]')?.click();
    expect(leftSidebarOpen()).toBe(true);

    setLeftSidebarOpen(false);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(document.activeElement).toBe(
      host.querySelector<HTMLButtonElement>('[aria-label="Show sessions"]'),
    );

    dispose();
    host.remove();
  });

  it("keeps the hide sessions control in the titlebar while the sidebar is open", () => {
    const host = document.createElement("div");
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    document.body.append(host);
    const dispose = render(
      () => (
        <Titlebar
          selectedTitle="Open session"
          leftSidebarOpen={leftSidebarOpen()}
          rightPanelOpen={false}
          rightPanelAvailable={false}
          onToggleLeftSidebar={() => setLeftSidebarOpen((open) => !open)}
          onToggleRightPanel={() => undefined}
        />
      ),
      host,
    );

    const hide = host.querySelector<HTMLButtonElement>('[aria-label="Hide sessions"]');
    if (!hide) throw new Error(`Titlebar did not render its hide control: ${host.innerHTML}`);
    expect(hide.closest(".titlebar-left-region")).not.toBeNull();
    const icon = hide.innerHTML;
    hide.click();
    expect(leftSidebarOpen()).toBe(false);
    const show = host.querySelector<HTMLButtonElement>('[aria-label="Show sessions"]');
    expect(show).toBe(hide);
    expect(show?.innerHTML).toBe(icon);

    dispose();
    host.remove();
  });
});
