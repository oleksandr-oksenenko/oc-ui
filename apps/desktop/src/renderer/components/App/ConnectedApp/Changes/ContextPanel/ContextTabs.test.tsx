import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";

import { ChangesTitlebarRegion } from "../ChangesTitlebarRegion.tsx";
import { ContextTabs } from "./ContextTabs.tsx";

describe("ContextTabs", () => {
  it("mounts the diff panel", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <ContextTabs diffContent={<div>Diff content</div>} />, host);

    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]');
    const tab = host.querySelector<HTMLElement>('[role="tab"]');

    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(tab).not.toBeNull();
    expect(tab?.getAttribute("aria-controls")).toBe(panel?.id);

    dispose();
    host.remove();
  });

  it("uses a plain titlebar label while keeping the close button actionable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let closeCount = 0;
    const dispose = render(() => <ChangesTitlebarRegion onClose={() => (closeCount += 1)} />, host);

    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tabpanel"]')).toBeNull();
    expect(host.querySelector(".context-tab-label")?.textContent).toBe("Diff");

    host.querySelector<HTMLButtonElement>('[aria-label="Hide context panel"]')?.click();
    expect(closeCount).toBe(1);

    dispose();
    host.remove();
  });

  it("labels panels directly when the mobile header is hidden", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <ContextTabs
          idBase="mobile-context"
          showHeader={false}
          diffContent={<div>Diff content</div>}
        />
      ),
      host,
    );

    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.getAttribute("aria-label")).toBe(
      "Diff",
    );
    expect(
      host.querySelector('[role="tabpanel"]:not([hidden])')?.hasAttribute("aria-labelledby"),
    ).toBe(false);

    dispose();
    host.remove();
  });
});
