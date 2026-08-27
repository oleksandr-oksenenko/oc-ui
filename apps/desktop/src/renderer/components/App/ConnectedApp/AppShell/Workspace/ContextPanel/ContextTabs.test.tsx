import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { ContextTabs, type ContextPanelTab } from "./ContextTabs.tsx";

describe("ContextTabs", () => {
  it("mounts only the active OpenCode tab panel", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onTabChange = vi.fn<(tab: ContextPanelTab) => void>();
    const dispose = render(
      () => (
        <ContextTabs
          activeTab="diff"
          diffContent={<div>Diff content</div>}
          filesContent={<div>Files content</div>}
          onTabChange={onTabChange}
        />
      ),
      host,
    );

    const panels = host.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.hasAttribute("hidden")).toBe(false);
    expect(host.textContent).not.toContain("Files content");

    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    expect(onTabChange).toHaveBeenCalledWith("files");

    dispose();
    host.remove();
  });

  it("labels panels directly when the mobile header is hidden", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <ContextTabs
          activeTab="files"
          showHeader={false}
          diffContent={<div>Diff content</div>}
          filesContent={<div>Files content</div>}
          onTabChange={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.getAttribute("aria-label")).toBe(
      "Files",
    );

    dispose();
    host.remove();
  });
});
