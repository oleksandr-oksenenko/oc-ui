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
});
