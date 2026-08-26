import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";

describe("SessionTree", () => {
  it("uses the OpenCode collapsible disclosure for nested sessions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const dispose = render(
      () => (
        <SessionTreeItem
          node={{
            id: "parent",
            title: "Parent",
            status: "idle",
            children: [{ id: "child", title: "Child", status: "idle" }],
          }}
          depth={0}
          selected
          expanded
          onSelect={() => undefined}
          onToggleExpanded={onToggleExpanded}
        >
          <div>Child</div>
        </SessionTreeItem>
      ),
      host,
    );

    const disclosure = host.querySelector<HTMLButtonElement>('[aria-label="Collapse Parent"]');
    expect(disclosure?.getAttribute("data-slot")).toBe("collapsible-trigger");
    expect(disclosure?.querySelector('[data-slot="collapsible-arrow"]')).not.toBeNull();
    expect(host.textContent).toContain("Child");

    disclosure?.click();
    expect(onToggleExpanded).toHaveBeenCalledWith("parent");

    dispose();
    host.remove();
  });
});
