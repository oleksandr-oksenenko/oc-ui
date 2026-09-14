import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { Titlebar } from "./Titlebar.tsx";

// Focus restoration is scheduled with a microtask; awaiting one more microtask
// lets the pending restoration run.
const settleFocus = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("Titlebar", () => {
  it("keeps global controls visible without replacing the context controls", () => {
    const [rightPanelOpen, setRightPanelOpen] = createSignal(true);
    const { host, dispose } = mount(() => (
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
    ));

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
  });

  it("keeps mobile titlebar content inert while an overlay is open", () => {
    const { host, dispose } = mount(() => (
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
    ));

    const titlebar = host.querySelector<HTMLElement>(".shell-titlebar");
    expect(titlebar?.getAttribute("aria-hidden")).toBe("true");
    expect(titlebar?.inert).toBe(true);
    expect(host.querySelector('[data-testid="global-controls"]')?.textContent).toBe(
      "Global requests",
    );

    dispose();
  });

  it("restores focus to the mobile sessions trigger after the overlay closes", async () => {
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(false);
    const { host, dispose } = mount(() => (
      <Titlebar
        mobile
        selectedTitle="Responsive session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => setLeftSidebarOpen(true)}
        onToggleRightPanel={() => undefined}
      />
    ));

    host.querySelector<HTMLButtonElement>('[aria-label="Show sessions"]')?.click();
    expect(leftSidebarOpen()).toBe(true);

    setLeftSidebarOpen(false);
    await settleFocus();

    expect(document.activeElement).toBe(
      host.querySelector<HTMLButtonElement>('[aria-label="Show sessions"]'),
    );

    dispose();
  });

  it("restores focus without forcing a scroll", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    const { dispose } = mount(() => (
      <Titlebar
        mobile
        selectedTitle="Responsive session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => undefined}
        onToggleRightPanel={() => undefined}
      />
    ));

    setLeftSidebarOpen(false);
    await settleFocus();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
    dispose();
  });

  it("does not steal focus the user moved before restoration", async () => {
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    const { dispose } = mount(() => (
      <Titlebar
        mobile
        selectedTitle="Responsive session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => undefined}
        onToggleRightPanel={() => undefined}
      />
    ));
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.append(outside);

    setLeftSidebarOpen(false);
    outside.focus();
    await settleFocus();

    expect(document.activeElement).toBe(outside);
    outside.remove();
    dispose();
  });

  it("cancels a pending focus restoration when the titlebar unmounts", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    const { dispose } = mount(() => (
      <Titlebar
        mobile
        selectedTitle="Responsive session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => undefined}
        onToggleRightPanel={() => undefined}
      />
    ));

    setLeftSidebarOpen(false);
    dispose();
    await settleFocus();

    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it("does not restore focus when the overlay reopens before the microtask", async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    const { host, dispose } = mount(() => (
      <Titlebar
        mobile
        selectedTitle="Responsive session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => undefined}
        onToggleRightPanel={() => undefined}
      />
    ));

    setLeftSidebarOpen(false);
    setLeftSidebarOpen(true);
    await settleFocus();

    expect(document.activeElement).not.toBe(
      host.querySelector<HTMLButtonElement>('[aria-label="Hide sessions"]'),
    );
    dispose();
  });

  it("keeps the hide sessions control in the titlebar while the sidebar is open", () => {
    const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
    const { host, dispose } = mount(() => (
      <Titlebar
        selectedTitle="Open session"
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={false}
        rightPanelAvailable={false}
        onToggleLeftSidebar={() => setLeftSidebarOpen((open) => !open)}
        onToggleRightPanel={() => undefined}
      />
    ));

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
  });
});
