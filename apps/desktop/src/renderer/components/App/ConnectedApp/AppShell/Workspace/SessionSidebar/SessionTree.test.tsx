import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { SessionSidebar } from "../SessionSidebar.tsx";
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

  it("keeps flat titles full-width and preserves needs-input status", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTreeItem
          node={{ id: "input", title: "Needs input", status: "running", needsInput: true }}
          depth={0}
          selected
          expanded={false}
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
        />
      ),
      host,
    );

    const row = host.querySelector(".shell-session-row");
    expect(row?.classList.contains("selected")).toBe(true);
    expect(row?.classList.contains("has-children")).toBe(false);
    expect(host.querySelector(".shell-session-disclosure-slot")).toBeNull();
    expect(host.querySelector(".shell-session-status")?.getAttribute("data-status")).toBe(
      "needs-input",
    );

    dispose();
  });
});

describe("SessionSidebar", () => {
  it("places the create action at the top of the session list", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionSidebar
          nodes={[]}
          expandedIDs={[]}
          loading={false}
          canCreate
          creating={false}
          serverName="Local server"
          serverStatus="connected"
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onCreate={() => undefined}
          onRetry={() => undefined}
          onSelectServer={() => undefined}
        />
      ),
      host,
    );

    const sidebar = host.querySelector(".shell-session-sidebar");
    expect(sidebar?.firstElementChild?.classList.contains("shell-session-header")).toBe(true);
    expect(
      sidebar?.firstElementChild?.querySelector('[aria-label="Create session"]'),
    ).not.toBeNull();

    dispose();
  });
});
