import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { TerminalPanel, type TerminalPanelProps } from "./TerminalPanel.tsx";

const callbacks = () => ({
  onCreate: vi.fn<() => void>(),
  onSelect: vi.fn<(id: string) => void>(),
  onClose: vi.fn<(id: string) => void>(),
  onReconnect: vi.fn<(id: string) => void>(),
  onHide: vi.fn<() => void>(),
});

describe("TerminalPanel", () => {
  it("retains tab identity and selection through immutable connection-status updates", async () => {
    const [tabs, setTabs] = createSignal<TerminalPanelProps["tabs"]>([
      { id: "1", title: "Build", status: "connected" },
      { id: "2", title: "Tests", status: "connecting" },
    ]);
    const [activeID, setActiveID] = createSignal("2");
    const view = mount(() => (
      <TerminalPanel
        {...callbacks()}
        onSelect={setActiveID}
        open
        canCreate
        activeID={activeID()}
        tabs={tabs()}
      />
    ));
    await Promise.resolve();
    const selectedTab = view.host.querySelector('[role="tab"][aria-label="Tests"]');
    setTabs((current) => current.map((tab) => ({ ...tab, status: "connected" })));
    await Promise.resolve();
    expect(view.host.querySelector('[role="tab"][aria-label="Tests"]')).toBe(selectedTab);
    expect(activeID()).toBe("2");
    expect(selectedTab?.getAttribute("aria-selected")).toBe("true");
    view.dispose();
  });
  it("requests actions without changing caller-controlled tabs or visibility", () => {
    const actions = callbacks();
    const { host, dispose } = mount(() => (
      <TerminalPanel
        {...actions}
        open
        canCreate
        activeID="1"
        tabs={[
          { id: "1", title: "Build", status: "connected" },
          { id: "2", title: "Tests", status: "failed", error: "Disconnected" },
        ]}
      />
    ));
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    button("New terminal").click();
    expect(actions.onCreate).toHaveBeenCalledTimes(1);
    button("Tests").click();
    expect(actions.onSelect).toHaveBeenCalledWith("2");
    expect(button("Build").getAttribute("aria-selected")).toBe("true");
    actions.onSelect.mockClear();
    button("Close terminal Tests").click();
    expect(actions.onClose).toHaveBeenCalledWith("2");
    expect(actions.onSelect).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    button("Hide terminal").click();
    expect(actions.onHide).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLElement>(".terminal-panel")!.hidden).toBe(false);
    dispose();
  });

  it("resolves supplied surfaces once and retains them through selection and visibility changes", () => {
    const [open, setOpen] = createSignal(true);
    const [activeID, setActiveID] = createSignal("1");
    let resolutions = 0;
    const surfaces = () => {
      resolutions += 1;
      return <input aria-label="Terminal input" />;
    };
    const { host, dispose } = mount(() => (
      <TerminalPanel
        {...callbacks()}
        open={open()}
        activeID={activeID()}
        canCreate
        tabs={[
          { id: "1", title: "Build", status: "connected" },
          { id: "2", title: "Tests", status: "connected" },
        ]}
      >
        {surfaces()}
      </TerminalPanel>
    ));
    const input = host.querySelector("input")!;
    input.value = "keep my command";
    setActiveID("2");
    setOpen(false);
    setOpen(true);
    expect(resolutions).toBe(1);
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("keep my command");
    dispose();
  });

  it("only reconnects failed tabs and disables create while unavailable or pending", () => {
    const actions = callbacks();
    const [tabs, setTabs] = createSignal<TerminalPanelProps["tabs"]>([
      { id: "1", title: "Build", status: "failed", error: "Connection lost" },
    ]);
    const [creating, setCreating] = createSignal(false);
    const [canCreate, setCanCreate] = createSignal(false);
    const { host, dispose } = mount(() => (
      <TerminalPanel
        {...actions}
        open
        activeID="1"
        tabs={tabs()}
        canCreate={canCreate()}
        creating={creating()}
      />
    ));
    const create = host.querySelector<HTMLButtonElement>('[aria-label="New terminal"]')!;
    expect(create.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Connection lost");
    const reconnect = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Reconnect terminal",
    )!;
    reconnect.click();
    expect(actions.onReconnect).toHaveBeenCalledWith("1");
    setCanCreate(true);
    setCreating(true);
    expect(create.disabled).toBe(true);
    setCreating(false);
    expect(create.disabled).toBe(false);
    setTabs([{ id: "1", title: "Build", status: "exited" }]);
    expect(host.textContent).not.toContain("Reconnect terminal");
    expect(host.textContent).toContain("Open a new terminal");
    dispose();
  });
});
