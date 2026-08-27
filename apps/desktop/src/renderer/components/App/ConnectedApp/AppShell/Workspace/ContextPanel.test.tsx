import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { ContextPanel } from "./ContextPanel.tsx";

describe("ContextPanel", () => {
  it("shows tab and close controls for an unavailable mobile overlay", () => {
    const host = document.createElement("div");
    const onTabChange = vi.fn<(tab: "diff" | "files") => void>();
    const onClose = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(
      () => <ContextPanel activeTab="diff" showTabs onTabChange={onTabChange} onClose={onClose} />,
      host,
    );

    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.textContent).toContain("Diff unavailable");
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    expect(onTabChange).toHaveBeenCalledWith("files");
    host.querySelector<HTMLButtonElement>('[aria-label="Hide context panel"]')?.click();
    expect(onClose).toHaveBeenCalledOnce();

    dispose();
    host.remove();
  });

  it("leaves unavailable desktop controls to the titlebar", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <ContextPanel
          activeTab="files"
          showTabs={false}
          onTabChange={() => undefined}
          onClose={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).toContain("Files unavailable");

    dispose();
  });
});
