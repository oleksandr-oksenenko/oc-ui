import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { ContextTabs } from "./ContextTabs.tsx";

describe("ContextTabs", () => {
  it("mounts the diff panel", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <ContextTabs diffContent={<div>Diff content</div>} />, host);

    const panels = host.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);

    dispose();
    host.remove();
  });

  it("labels panels directly when the mobile header is hidden", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => <ContextTabs showHeader={false} diffContent={<div>Diff content</div>} />,
      host,
    );

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.getAttribute("aria-label")).toBe(
      "Diff",
    );

    dispose();
    host.remove();
  });
});
