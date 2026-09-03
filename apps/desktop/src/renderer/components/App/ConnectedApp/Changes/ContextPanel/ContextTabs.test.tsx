import { describe, expect, it } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { ChangesTitlebarRegion } from "../ChangesTitlebarRegion.tsx";
import { ContextTabs } from "./ContextTabs.tsx";

describe("ContextTabs", () => {
  it("mounts the diff panel", () => {
    const { host, dispose } = mount(() => <ContextTabs diffContent={<div>Diff content</div>} />);

    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]');
    const tab = host.querySelector<HTMLElement>('[role="tab"]');

    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(tab).not.toBeNull();
    expect(tab?.getAttribute("aria-controls")).toBe(panel?.id);

    dispose();
  });

  it("uses a plain titlebar label while keeping the close button actionable", () => {
    let closeCount = 0;
    const { host, dispose } = mount(() => (
      <ChangesTitlebarRegion onClose={() => (closeCount += 1)} />
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
