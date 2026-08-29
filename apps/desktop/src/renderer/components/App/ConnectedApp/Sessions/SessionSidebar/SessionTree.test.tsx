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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

const sidebarProps = (overrides: Partial<Parameters<typeof SessionSidebar>[0]> = {}) => ({
  sessions: [],
  statusForSession: () => "idle" as const,
  expandedIDs: [],
  loading: false,
  canCreate: true,
  canDelete: true,
  deletionStatusForSession: () => "ready" as const,
  serverName: "Local server",
  serverStatus: "connected" as const,
  onSelect: () => undefined,
  onToggleExpanded: () => undefined,
  onDelete: () => undefined,
  onCreate: () => undefined,
  onRetry: () => undefined,
  onSelectServer: () => undefined,
  ...overrides,
});

const inputEvent = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const fixedNow = 1788004800000;

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
          deletionStatusForSession={() => "ready"}
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
          deletionStatusForSession={() => "ready"}
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
          deletionStatusForSession={() => "ready"}
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

  it("groups roots into Today, This week, and Earlier using updated timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const now = fixedNow;
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [
              session("today", "Today session", undefined, now - 60 * 60 * 1000),
              session("week", "This week session", undefined, now - 3 * 24 * 60 * 60 * 1000),
              session("earlier", "Earlier session", undefined, now - 14 * 24 * 60 * 60 * 1000),
            ],
          })}
        />
      ),
      host,
    );

    expect([...host.querySelectorAll("section h2")].map((heading) => heading.textContent)).toEqual([
      "Today",
      "This week",
      "Earlier",
    ]);

    dispose();
    host.remove();
  });

  it("keeps a recently updated descendant with its old root in Today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const now = fixedNow;
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [
              session("old-root", "Old root", undefined, now - 14 * 24 * 60 * 60 * 1000),
              session("recent-child", "Recent child", "old-root", now - 60 * 60 * 1000),
              session("old-other", "Old other", undefined, now - 14 * 24 * 60 * 60 * 1000),
            ],
            expandedIDs: ["old-root"],
          })}
        />
      ),
      host,
    );

    const today = [...host.querySelectorAll("section")].find(
      (section) => section.querySelector("h2")?.textContent === "Today",
    );
    const earlier = [...host.querySelectorAll("section")].find(
      (section) => section.querySelector("h2")?.textContent === "Earlier",
    );
    expect(today?.textContent).toContain("Old root");
    expect(today?.textContent).toContain("Recent child");
    expect(earlier?.textContent).toContain("Old other");
    expect(earlier?.textContent).not.toContain("Old root");

    dispose();
    host.remove();
  });

  it("reserves the disclosure gutter for leaf titles and shows runtime status", () => {
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
    expect(host.querySelector(".shell-session-disclosure-slot")).not.toBeNull();
    expect(host.querySelector(".shell-session-disclosure")).toBeNull();
    expect(host.querySelector(".shell-session-status")?.getAttribute("data-status")).toBe(
      "running",
    );
    expect(host.querySelector(".shell-session-status")?.parentElement?.className).toBe(
      "shell-session-row-end",
    );
    expect(host.querySelector('[aria-label="Delete Running"]')?.parentElement?.className).toBe(
      "shell-session-row-end",
    );

    dispose();
  });

  it("places the future requires-input dot in the shared row-end slot", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTreeItem
          session={session("input", "Needs input")}
          status="idle"
          requiresInput
          hasChildren={false}
          depth={0}
          selected={false}
          expanded={false}
          deleteDisabled={false}
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={() => undefined}
        />
      ),
      host,
    );

    const status = host.querySelector('[data-status="requires-input"]');
    expect(status?.getAttribute("aria-label")).toBe("Requires input");
    expect(status?.querySelector(".shell-session-input-required")).not.toBeNull();
    expect(status?.parentElement?.className).toBe("shell-session-row-end");
    expect(host.querySelector('[aria-label="Delete Needs input"]')?.parentElement).toBe(
      status?.parentElement,
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
          deletionStatusForSession={() => "ready"}
          onSelect={() => undefined}
          onToggleExpanded={() => undefined}
          onDelete={onDelete}
        />
      ),
      host,
    );

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Delete One"]');
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(button?.parentElement?.lastElementChild).toBe(button);
    button?.click();
    expect(onDelete).toHaveBeenCalledWith("one", button);

    dispose();
    host.remove();
  });

  it("uses deletion eligibility supplied by the Sessions domain", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTree
          sessions={[session("root", "Root"), session("child", "Child", "root")]}
          statusForSession={(id) => (id === "child" ? "running" : "idle")}
          expandedIDs={["root"]}
          canDelete
          deletionStatusForSession={() => "running"}
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
  it("renders the filter and keeps matching ancestors while pruning unrelated branches", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [
              session("matching-root", "Project work"),
              session("matching-parent", "Architecture notes", "matching-root"),
              session("matching-child", "Deep MATCH result", "matching-parent"),
              session("unrelated-root", "Personal notes"),
              session("unrelated-child", "Unrelated child", "unrelated-root"),
            ],
            expandedIDs: [],
          })}
        />
      ),
      host,
    );

    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter sessions"]');
    expect(filter).not.toBeNull();
    expect(filter?.placeholder).toBe("Filter sessions");
    inputEvent(filter!, "match");

    expect(host.querySelector('[aria-label="Project work, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Architecture notes, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Deep MATCH result, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Personal notes, Idle"]')).toBeNull();
    expect(host.querySelector('[aria-label="Unrelated child, Idle"]')).toBeNull();
    expect(host.querySelector('[aria-label="Collapse Project work"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Collapse Architecture notes"]')).not.toBeNull();

    dispose();
    host.remove();
  });

  it("clearing the filter restores controlled expansion and reports no matches distinctly", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [session("root", "Root"), session("child", "Matching child", "root")],
            expandedIDs: [],
          })}
        />
      ),
      host,
    );
    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter sessions"]');
    expect(filter).not.toBeNull();

    inputEvent(filter!, "does-not-exist");
    expect(host.textContent).toContain("No sessions match");
    expect(host.textContent).not.toContain("No sessions yet.");

    inputEvent(filter!, "matching");
    expect(host.querySelector('[aria-label="Matching child, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Collapse Root"]')).not.toBeNull();

    inputEvent(filter!, "");
    expect(host.querySelector('[aria-label="Expand Root"]')).not.toBeNull();

    dispose();
    host.remove();
  });

  it("does not expose a requires-input state", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [session("idle", "Idle"), session("running", "Running")],
            statusForSession: (id) => (id === "running" ? "running" : "idle"),
          })}
        />
      ),
      host,
    );

    expect(host.textContent).not.toContain("Requires input");
    expect(host.querySelector('[aria-label="Running, Running"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Idle, Idle"]')).not.toBeNull();

    dispose();
  });

  it("renders requires-input state only when the view contract supplies it", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionSidebar
          {...sidebarProps({
            sessions: [session("input", "Needs input")],
            requiresInputForSession: (id) => id === "input",
          })}
        />
      ),
      host,
    );

    expect(host.querySelector('[data-status="requires-input"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Needs input, Requires input"]')).not.toBeNull();

    dispose();
  });

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
          deletionStatusForSession={() => "ready"}
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
