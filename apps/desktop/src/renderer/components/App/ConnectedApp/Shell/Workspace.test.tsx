import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { Workspace } from "./Workspace.tsx";

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  options: {
    readonly pointerID: number;
    readonly clientX?: number;
    readonly clientY?: number;
    readonly button?: number;
  },
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: options.button ?? 0,
    clientX: options.clientX,
    clientY: options.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: options.pointerID });
  return event;
}

describe("Workspace", () => {
  it("resolves each live content slot once", () => {
    const host = document.createElement("div");
    const [version, setVersion] = createSignal("first");
    const resolutions = { sidebar: 0, main: 0, context: 0, bottom: 0 };
    const slot = (name: keyof typeof resolutions) => {
      resolutions[name] += 1;
      return <div>{version()}</div>;
    };
    const dispose = render(
      () => (
        <Workspace
          leftSidebarOpen
          rightPanelOpen
          sidebar={slot("sidebar")}
          main={slot("main")}
          context={slot("context")}
          bottom={slot("bottom")}
        />
      ),
      host,
    );

    expect(resolutions).toEqual({ sidebar: 1, main: 1, context: 1, bottom: 1 });
    setVersion("second");
    expect(host.textContent).toBe("secondsecondsecondsecond");
    expect(resolutions).toEqual({ sidebar: 1, main: 1, context: 1, bottom: 1 });

    dispose();
  });

  it("resizes both sidebars from accessible separator controls", () => {
    const { host, dispose } = mount(() => (
      <main class="app-shell-v2">
        <Workspace
          leftSidebarOpen
          rightPanelOpen
          sidebar={<div>Sessions</div>}
          main={<div>Transcript</div>}
          context={<div>Context</div>}
        />
      </main>
    ));

    const separators = host.querySelectorAll<HTMLElement>('[role="separator"]');
    expect(separators).toHaveLength(2);
    const [leftSeparator, rightSeparator] = separators;
    if (!leftSeparator || !rightSeparator) throw new Error("Workspace did not render separators");

    leftSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    rightSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(leftSeparator.getAttribute("aria-valuenow")).toBe("264");
    expect(rightSeparator.getAttribute("aria-valuenow")).toBe("376");
    const shell = host.querySelector<HTMLElement>(".app-shell-v2");
    expect(shell?.style.getPropertyValue("--shell-left-sidebar-width")).toBe("264px");
    expect(shell?.style.getPropertyValue("--shell-right-panel-width")).toBe("376px");

    dispose();
  });

  it("tracks pointer drags outside the resize handle and highlights only the active side", () => {
    const { host, dispose } = mount(() => (
      <main class="app-shell-v2">
        <Workspace
          leftSidebarOpen
          rightPanelOpen
          sidebar={<div>Sessions</div>}
          main={<div>Transcript</div>}
          context={<div>Context</div>}
        />
      </main>
    ));

    const workspace = host.querySelector<HTMLElement>(".shell-workspace");
    const left = host.querySelector<HTMLElement>(".shell-left-resize-handle");
    const right = host.querySelector<HTMLElement>(".shell-right-resize-handle");
    if (!workspace || !left || !right) throw new Error("Workspace did not render resize handles");

    left.dispatchEvent(pointerEvent("pointerdown", { pointerID: 7, clientX: 220 }));
    expect(workspace.classList.contains("resizing-left")).toBe(true);
    expect(workspace.classList.contains("resizing-right")).toBe(false);
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 7, clientX: 260 }));
    expect(
      host
        .querySelector<HTMLElement>(".app-shell-v2")
        ?.style.getPropertyValue("--shell-left-sidebar-width"),
    ).toBe("288px");
    window.dispatchEvent(pointerEvent("pointerup", { pointerID: 7, clientX: 260 }));
    expect(workspace.classList.contains("resizing")).toBe(false);

    right.dispatchEvent(pointerEvent("pointerdown", { pointerID: 8, clientX: 640 }));
    expect(workspace.classList.contains("resizing-right")).toBe(true);
    expect(workspace.classList.contains("resizing-left")).toBe(false);
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 8, clientX: 600 }));
    expect(
      host
        .querySelector<HTMLElement>(".app-shell-v2")
        ?.style.getPropertyValue("--shell-right-panel-width"),
    ).toBe("400px");
    window.dispatchEvent(pointerEvent("pointerup", { pointerID: 8, clientX: 600 }));

    left.dispatchEvent(pointerEvent("pointerdown", { pointerID: 9, clientX: 260 }));
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 10, clientX: 300 }));
    expect(
      host
        .querySelector<HTMLElement>(".app-shell-v2")
        ?.style.getPropertyValue("--shell-left-sidebar-width"),
    ).toBe("288px");
    window.dispatchEvent(pointerEvent("pointercancel", { pointerID: 9, clientX: 260 }));
    expect(workspace.classList.contains("resizing")).toBe(false);

    dispose();
  });

  it("starts pointer and keyboard resizing from the rendered panel width", () => {
    const { host, dispose } = mount(() => (
      <main class="app-shell-v2">
        <Workspace
          leftSidebarOpen={false}
          rightPanelOpen
          main={<div>Transcript</div>}
          context={<div>Context</div>}
        />
      </main>
    ));
    const panel = host.querySelector<HTMLElement>(".shell-right-panel")!;
    const handle = host.querySelector<HTMLElement>(".shell-right-resize-handle")!;
    const shell = host.querySelector<HTMLElement>(".app-shell-v2")!;
    Object.defineProperty(panel, "offsetWidth", { configurable: true, value: 400 });

    handle.dispatchEvent(pointerEvent("pointerdown", { pointerID: 1, clientX: 800 }));
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 1, clientX: 790 }));
    expect(shell.style.getPropertyValue("--shell-right-panel-width")).toBe("410px");
    window.dispatchEvent(pointerEvent("pointerup", { pointerID: 1, clientX: 790 }));

    Object.defineProperty(panel, "offsetWidth", { configurable: true, value: 380 });
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(shell.style.getPropertyValue("--shell-right-panel-width")).toBe("396px");
    dispose();
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
    const { host, dispose } = mount(() => (
      <Workspace
        mobile
        leftSidebarOpen
        rightPanelOpen
        sidebar={<div>Sessions</div>}
        main={<button type="button">Transcript action</button>}
        context={<div>Context</div>}
      />
    ));

    expect(
      host.querySelector('[role="dialog"][aria-label="Sessions"]')?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(
      host
        .querySelector('[role="dialog"][aria-label="Workspace context"]')
        ?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(host.querySelector(".shell-main")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector<HTMLElement>(".shell-main")?.inert).toBe(true);
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0);

    dispose();
  });

  it("moves focus into a mobile overlay when it opens", async () => {
    const [leftOpen, setLeftOpen] = createSignal(false);
    const [rightOpen, setRightOpen] = createSignal(false);
    const { host, dispose } = mount(() => (
      <Workspace
        mobile
        leftSidebarOpen={leftOpen()}
        rightPanelOpen={rightOpen()}
        sidebar={<button autofocus>Hide sessions</button>}
        main={<button type="button">Transcript action</button>}
        context={<button autofocus>Hide context</button>}
      />
    ));

    setLeftOpen(true);
    await Promise.resolve();
    expect(host.querySelector(".shell-left-sidebar [autofocus]")).toBe(document.activeElement);

    setLeftOpen(false);
    setRightOpen(true);
    await Promise.resolve();
    expect(host.querySelector(".shell-right-panel [autofocus]")).toBe(document.activeElement);

    dispose();
  });

  it("retains bottom content across hide/show and makes it inert behind mobile overlays", () => {
    const [open, setOpen] = createSignal(true);
    const [sidebarOpen, setSidebarOpen] = createSignal(false);
    const { host, dispose } = mount(() => (
      <Workspace
        mobile
        leftSidebarOpen={sidebarOpen()}
        rightPanelOpen={false}
        sidebar={<button>Sessions</button>}
        main={<div>Chat</div>}
        bottomOpen={open()}
        bottom={<input aria-label="Terminal command" />}
      />
    ));
    const bottom = host.querySelector<HTMLElement>(".shell-bottom-panel")!;
    const input = bottom.querySelector("input")!;
    input.value = "pnpm dev";
    setOpen(false);
    expect(bottom.hidden).toBe(true);
    expect(bottom.inert).toBe(true);
    expect(host.querySelector(".shell-bottom-resize-handle")).toBeNull();
    setOpen(true);
    expect(bottom.hidden).toBe(false);
    expect(bottom.inert).toBe(false);
    expect(bottom.querySelector("input")).toBe(input);
    expect(input.value).toBe("pnpm dev");
    setSidebarOpen(true);
    expect(bottom.inert).toBe(true);
    expect(bottom.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".shell-bottom-resize-handle")).toBeNull();
    dispose();
  });

  it("resizes the bottom with keyboard and pointer while preserving minimum chat height", () => {
    const { host, dispose } = mount(() => (
      <Workspace
        leftSidebarOpen={false}
        rightPanelOpen={false}
        main={<div>Chat</div>}
        bottomOpen
        bottom={<div>Terminal</div>}
      />
    ));
    const workspace = host.querySelector<HTMLElement>(".shell-workspace")!;
    const bottom = host.querySelector<HTMLElement>(".shell-bottom-panel")!;
    const handle = host.querySelector<HTMLElement>(".shell-bottom-resize-handle")!;
    Object.defineProperty(workspace, "clientHeight", { configurable: true, value: 500 });
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(handle.getAttribute("aria-valuenow")).toBe("296");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(handle.getAttribute("aria-valuenow")).toBe("340");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(handle.getAttribute("aria-valuenow")).toBe("120");
    Object.defineProperty(bottom, "offsetHeight", { configurable: true, value: 200 });
    handle.dispatchEvent(pointerEvent("pointerdown", { pointerID: 1, clientY: 300 }));
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 2, clientY: 290 }));
    expect(handle.getAttribute("aria-valuenow")).toBe("120");
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 1, clientY: 250 }));
    expect(workspace.style.getPropertyValue("--shell-bottom-panel-height")).toBe("250px");
    window.dispatchEvent(pointerEvent("pointercancel", { pointerID: 1, clientY: 250 }));
    expect(workspace.classList.contains("resizing")).toBe(false);
    dispose();
    window.dispatchEvent(pointerEvent("pointermove", { pointerID: 1, clientY: 200 }));
    expect(workspace.style.getPropertyValue("--shell-bottom-panel-height")).toBe("250px");
  });
});
