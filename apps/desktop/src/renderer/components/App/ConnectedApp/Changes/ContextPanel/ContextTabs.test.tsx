import { describe, expect, it } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { ContextTitlebarRegion } from "../../Shell/ContextTitlebarRegion.tsx";
import { ContextTabs } from "./ContextTabs.tsx";

describe("ContextTabs", () => {
  it("mounts the diff panel", () => {
    const { host, dispose } = mount(() => <ContextTabs diffContent={<div>Diff content</div>} />);

    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]');
    const tab = host.querySelector<HTMLElement>('[role="tab"]');

    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Diff content");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(tab).not.toBeNull();
    expect(tab?.getAttribute("aria-controls")).toBe(panel?.id);
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab?.id);
    expect(document.getElementById(tab!.id)).toBe(tab);
    expect(document.getElementById(panel!.id)).toBe(panel);

    dispose();
  });

  it("uses a plain titlebar label while keeping the close button actionable", () => {
    let closeCount = 0;
    const { host, dispose } = mount(() => (
      <ContextTitlebarRegion onClose={() => (closeCount += 1)} />
    ));

    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tabpanel"]')).toBeNull();
    expect(host.querySelector(".context-tab-label")?.textContent).toBe("Diff");

    host.querySelector<HTMLButtonElement>('[aria-label="Hide context panel"]')?.click();
    expect(closeCount).toBe(1);

    dispose();
  });
});
