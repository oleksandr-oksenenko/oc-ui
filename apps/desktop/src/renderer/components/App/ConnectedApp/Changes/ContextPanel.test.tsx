import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../test/mount.ts";
import { ContextPanel } from "./ContextPanel.tsx";

describe("ContextPanel", () => {
  it("shows tab and close controls for an unavailable mobile overlay", () => {
    const onClose = vi.fn<() => void>();
    const { host, dispose } = mount(() => <ContextPanel files={[]} showTabs onClose={onClose} />);

    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.textContent).toContain("Diff unavailable");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[aria-label="Hide context panel"]')?.click();
    expect(onClose).toHaveBeenCalledOnce();

    dispose();
  });

  it("leaves unavailable desktop controls to the titlebar", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => <ContextPanel files={[]} showTabs={false} onClose={() => undefined} />,
      host,
    );

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).toContain("Diff unavailable");

    dispose();
  });
});
