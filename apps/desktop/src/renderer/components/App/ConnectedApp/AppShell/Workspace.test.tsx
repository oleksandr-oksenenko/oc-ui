import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { Workspace } from "./Workspace.tsx";

describe("Workspace", () => {
  it("resizes both sidebars from accessible separator controls", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <main class="app-shell-v2">
          <Workspace
            leftSidebarOpen
            rightPanelOpen
            sidebar={<div>Sessions</div>}
            main={<div>Transcript</div>}
            context={<div>Context</div>}
          />
        </main>
      ),
      host,
    );

    const separators = host.querySelectorAll<HTMLElement>('[role="separator"]');
    expect(separators).toHaveLength(2);
    const [leftSeparator, rightSeparator] = separators;
    if (!leftSeparator || !rightSeparator) throw new Error("Workspace did not render separators");

    leftSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    rightSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(leftSeparator.getAttribute("aria-valuenow")).toBe("216");
    expect(rightSeparator.getAttribute("aria-valuenow")).toBe("376");
    const shell = host.querySelector<HTMLElement>(".app-shell-v2");
    expect(shell?.style.getPropertyValue("--shell-left-sidebar-width")).toBe("216px");
    expect(shell?.style.getPropertyValue("--shell-right-panel-width")).toBe("376px");

    dispose();
    host.remove();
  });

  it("only exposes resize handles for visible sidebars", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <Workspace
          leftSidebarOpen={false}
          rightPanelOpen={false}
          sidebar={<div>Sessions</div>}
          main={<div>Transcript</div>}
          context={<div>Context</div>}
        />
      ),
      host,
    );

    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0);
    dispose();
  });

  it("uses modal dialogs, inert main content, and no resize handles on mobile", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Workspace
          mobile
          leftSidebarOpen
          rightPanelOpen
          sidebar={<div>Sessions</div>}
          main={<button type="button">Transcript action</button>}
          context={<div>Context</div>}
        />
      ),
      host,
    );

    expect(
      host.querySelector('[role="dialog"][aria-label="Sessions"]')?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(
      host
        .querySelector('[role="dialog"][aria-label="Workspace context"]')
        ?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(host.querySelector(".shell-main")?.getAttribute("aria-hidden")).toBe("true");
    expect((host.querySelector(".shell-main") as HTMLElement & { inert?: boolean })?.inert).toBe(
      true,
    );
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0);

    dispose();
    host.remove();
  });
});
