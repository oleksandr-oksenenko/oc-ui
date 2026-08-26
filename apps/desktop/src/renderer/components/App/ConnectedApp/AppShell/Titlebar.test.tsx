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
          leftControls={<button type="button">Close sessions</button>}
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
});
