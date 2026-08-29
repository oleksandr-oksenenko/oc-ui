import type { SessionInfo } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionSidebar } from "../SessionSidebar.tsx";
import { SessionTree } from "./SessionTree.tsx";
import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const session = (id: string, title: string, parentID?: string, updated = 1): SessionInfo => ({
  id,
  title,
  parentID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated },
  location: { directory: "/project" },
});

describe("SessionTree", () => {
  it("renders recursive children and selects them through the same callback", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onSelect = vi.fn<(sessionID: string) => void>();
    const dispose = render(
      () => (
        <SessionTree
          sessions={[
            session("root", "Root"),
            session("child", "Child", "root"),
            session("grandchild", "Grandchild", "child"),
          ]}
          statusForSession={(sessionID) => (sessionID === "child" ? "running" : "idle")}
          selectedID="child"
          expandedIDs={["root", "child"]}
          canDelete
          onSelect={onSelect}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector('[aria-label="Child, Running"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(host.querySelectorAll(".shell-session-children")).toHaveLength(2);
    const grandchild = await vi.waitFor(() => {
      const button = host.querySelector<HTMLButtonElement>('[aria-label="Grandchild, Idle"]');
      expect(button).not.toBeNull();
      if (button === null) throw new Error("Grandchild session button was not rendered");
      return button;
    });
    grandchild.click();
    expect(onSelect).toHaveBeenCalledWith("grandchild");

    dispose();
    host.remove();
  });

  it("uses the OpenCode collapsible disclosure for nested sessions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const dispose = render(
      () => (
        <SessionTreeItem
          session={session("parent", "Parent")}
          status="idle"
          hasChildren
          depth={0}
          selected
          expanded
          deleteDisabled={false}
          onSelect={() => undefined}
          onToggleExpanded={onToggleExpanded}
          onDelete={() => undefined}
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

  it("keeps a session visible when its parent is absent", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTree
          sessions={[session("orphan", "Orphan", "missing")]}
          statusForSession={() => "idle"}
          expandedIDs={[]}
          canDelete
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector('[aria-label="Orphan, Idle"]')).not.toBeNull();

    dispose();
  });

  it("preserves the ordered runtime list for roots and siblings", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTree
          sessions={[
            session("new-root", "New root", undefined, 40),
            session("new-child", "New child", "new-root", 30),
            session("old-child", "Old child", "new-root", 20),
            session("old-root", "Old root", undefined, 10),
          ]}
          statusForSession={() => "idle"}
          expandedIDs={["new-root"]}
          canDelete
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    expect(
      [...host.querySelectorAll<HTMLButtonElement>(".shell-session-main")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["New root", "New child", "Old child", "Old root"]);

    dispose();
  });

  it("keeps flat titles full-width and shows runtime status", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTreeItem
          session={session("running", "Running")}
          status="running"
          hasChildren={false}
          depth={0}
          selected
          expanded={false}
          deleteDisabled={false}
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    const row = host.querySelector(".shell-session-row");
    expect(row?.classList.contains("selected")).toBe(true);
    expect(row?.classList.contains("has-children")).toBe(false);
    expect(host.querySelector(".shell-session-disclosure-slot")).toBeNull();
    expect(host.querySelector(".shell-session-status")?.getAttribute("data-status")).toBe(
      "running",
    );

    dispose();
  });

  it("places a delete action at the end of each session row", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onDelete = vi.fn<(sessionID: string, opener: HTMLButtonElement) => void>();
    const dispose = render(
      () => (
        <SessionTree
          sessions={[session("one", "One")]}
          statusForSession={() => "idle"}
          expandedIDs={[]}
          canDelete
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={onDelete}
        />
      ),
      host,
    );

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Delete One"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(onDelete).toHaveBeenCalledWith("one", button);

    dispose();
    host.remove();
  });

  it("disables deletion while a session in the subtree is running", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTree
          sessions={[session("root", "Root"), session("child", "Child", "root")]}
          statusForSession={(id) => (id === "child" ? "running" : "idle")}
          expandedIDs={["root"]}
          canDelete
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector<HTMLButtonElement>('[aria-label="Delete Root"]')?.disabled).toBe(
      true,
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Delete Child"]')?.disabled).toBe(
      true,
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
          sessions={[]}
          statusForSession={() => "idle"}
          expandedIDs={[]}
          loading={false}
          canCreate
          canDelete
          serverName="Local server"
          serverStatus="connected"
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
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
