import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { ContextPanel } from "./ContextPanel.tsx";

describe("ContextPanel", () => {
  it("shows tab and close controls for an unavailable mobile overlay", () => {
    const host = document.createElement("div");
    const onClose = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(() => <ContextPanel showTabs onClose={onClose} />, host);

    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.textContent).toContain("Diff unavailable");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[aria-label="Hide context panel"]')?.click();
    expect(onClose).toHaveBeenCalledOnce();

    dispose();
    host.remove();
  });

  it("leaves unavailable desktop controls to the titlebar", () => {
    const host = document.createElement("div");
    const dispose = render(() => <ContextPanel showTabs={false} onClose={() => undefined} />, host);

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).toContain("Diff unavailable");

    dispose();
  });
});
