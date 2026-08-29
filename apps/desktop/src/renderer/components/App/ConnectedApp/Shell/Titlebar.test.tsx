import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { Titlebar } from "./Titlebar.tsx";

describe("Titlebar", () => {
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
