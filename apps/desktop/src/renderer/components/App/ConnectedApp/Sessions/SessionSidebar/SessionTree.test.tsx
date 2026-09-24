import type { SessionInfo } from "@opencode/client";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { sessionFixture } from "../../../../../test/session-fixture.ts";
import { stubResizeObserver } from "../../../../../test/resize-observer.ts";
import { SessionSidebar } from "../SessionSidebar.tsx";
import { SessionTree } from "./SessionTree.tsx";
import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";

beforeEach(() => {
  stubResizeObserver();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const session = (id: string, title: string, parentID?: string, updated = 1): SessionInfo =>
  sessionFixture({
    id,
    title,
    parentID,
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
    const onSelect = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
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
    ));

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
  });

  it("toggles a selected parent's children from the title", () => {
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const onSelect = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
      <SessionTreeItem
        session={session("parent", "Parent")}
        status="idle"
        hasChildren
        selected
        expanded
        deleteDisabled={false}
        onSelect={onSelect}
        onToggleExpanded={onToggleExpanded}
        onDelete={() => undefined}
      >
        <div>Child</div>
      </SessionTreeItem>
    ));

    const disclosure = host.querySelector<HTMLButtonElement>('[aria-label="Parent, Idle"]');
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");

    expect(host.textContent).toContain("Child");

    disclosure?.click();
    expect(onToggleExpanded).toHaveBeenCalledExactlyOnceWith("parent");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("parent");
    onSelect.mockClear();
    onToggleExpanded.mockClear();
    host.querySelector<HTMLButtonElement>('[aria-label="Collapse Parent"]')?.click();
    expect(onToggleExpanded).toHaveBeenCalledExactlyOnceWith("parent");
    expect(onSelect).not.toHaveBeenCalled();

    dispose();
  });

  it("selects an unselected parent without toggling its children", () => {
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const onSelect = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
      <SessionTreeItem
        session={session("parent", "Parent")}
        status="idle"
        hasChildren
        selected={false}
        expanded={false}
        deleteDisabled={false}
        onSelect={onSelect}
        onToggleExpanded={onToggleExpanded}
        onDelete={() => undefined}
      >
        <div>Child</div>
      </SessionTreeItem>
    ));

    const title = host.querySelector<HTMLButtonElement>('[aria-label="Parent, Idle"]');
    expect(title?.getAttribute("aria-expanded")).toBe("false");
    title?.click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("parent");
    expect(onToggleExpanded).not.toHaveBeenCalled();
    expect(title?.getAttribute("aria-expanded")).toBe("false");

    dispose();
  });

  it("keeps an unselected parent's open children when selecting it", () => {
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const onSelect = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
      <SessionTreeItem
        session={session("parent", "Parent")}
        status="idle"
        hasChildren
        selected={false}
        expanded
        deleteDisabled={false}
        onSelect={onSelect}
        onToggleExpanded={onToggleExpanded}
        onDelete={() => undefined}
      >
        <div>Child</div>
      </SessionTreeItem>
    ));

    host.querySelector<HTMLButtonElement>('[aria-label="Parent, Idle"]')?.click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("parent");
    expect(onToggleExpanded).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Child");

    dispose();
  });

  it("toggles an unselected parent from its disclosure without selecting", () => {
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const onSelect = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
      <SessionTreeItem
        session={session("parent", "Parent")}
        status="idle"
        hasChildren
        selected={false}
        expanded={false}
        deleteDisabled={false}
        onSelect={onSelect}
        onToggleExpanded={onToggleExpanded}
        onDelete={() => undefined}
      >
        <div>Child</div>
      </SessionTreeItem>
    ));

    host.querySelector<HTMLButtonElement>('[aria-label="Expand Parent"]')?.click();
    expect(onToggleExpanded).toHaveBeenCalledExactlyOnceWith("parent");
    expect(onSelect).not.toHaveBeenCalled();

    dispose();
  });

  it("selects a parent before toggling its children across selection changes", () => {
    const { host, dispose } = mount(() => {
      const [selectedID, setSelectedID] = createSignal<string>();
      const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([]);
      return (
        <SessionTree
          sessions={[session("parent", "Parent"), session("child", "Child", "parent")]}
          statusForSession={() => "idle"}
          selectedID={selectedID()}
          expandedIDs={expandedIDs()}
          canDelete
          deletionStatusForSession={() => "ready"}
          onSelect={setSelectedID}
          onToggleExpanded={(sessionID) =>
            setExpandedIDs((current) =>
              current.includes(sessionID)
                ? current.filter((id) => id !== sessionID)
                : [...current, sessionID],
            )
          }
          onDelete={() => undefined}
        />
      );
    });

    const parent = host.querySelector<HTMLButtonElement>('[aria-label="Parent, Idle"]');
    const child = () => host.querySelector<HTMLButtonElement>('[aria-label="Child, Idle"]');

    parent?.click();
    expect(parent?.getAttribute("aria-current")).toBe("page");
    expect(parent?.getAttribute("aria-expanded")).toBe("false");
    expect(child()).toBeNull();

    parent?.click();
    expect(parent?.getAttribute("aria-expanded")).toBe("true");
    expect(child()).not.toBeNull();

    child()?.click();
    expect(child()?.getAttribute("aria-current")).toBe("page");
    expect(parent?.getAttribute("aria-current")).toBeNull();

    parent?.click();
    expect(parent?.getAttribute("aria-current")).toBe("page");
    expect(parent?.getAttribute("aria-expanded")).toBe("true");
    expect(child()).not.toBeNull();

    parent?.click();
    expect(parent?.getAttribute("aria-expanded")).toBe("false");
    expect(child()).toBeNull();

    dispose();
  });

  it("renders ordered roots and siblings while retaining an orphan", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTree
          sessions={[
            session("new-root", "New root", undefined, 40),
            session("new-child", "New child", "new-root", 30),
            session("old-child", "Old child", "new-root", 20),
            session("orphan", "Orphan", "missing", 15),
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
    ).toEqual(["New root", "New child", "Old child", "Orphan", "Old root"]);

    dispose();
  });

  it("groups roots into Today, This week, and Earlier using updated timestamps", () => {
    const now = fixedNow;
    const { host, dispose } = mount(() => (
      <SessionSidebar
        {...sidebarProps({
          now,
          sessions: [
            session("today", "Today session", undefined, now - 60 * 60 * 1000),
            session("week", "This week session", undefined, now - 3 * 24 * 60 * 60 * 1000),
            session("earlier", "Earlier session", undefined, now - 14 * 24 * 60 * 60 * 1000),
          ],
        })}
      />
    ));

    expect([...host.querySelectorAll("section h2")].map((heading) => heading.textContent)).toEqual([
      "Today",
      "This week",
      "Earlier",
    ]);

    dispose();
  });

  it("keeps a recently updated descendant with its old root in Today", () => {
    const now = fixedNow;
    const { host, dispose } = mount(() => (
      <SessionSidebar
        {...sidebarProps({
          now,
          sessions: [
            session("old-root", "Old root", undefined, now - 14 * 24 * 60 * 60 * 1000),
            session("recent-child", "Recent child", "old-root", now - 60 * 60 * 1000),
            session("old-other", "Old other", undefined, now - 14 * 24 * 60 * 60 * 1000),
          ],
          expandedIDs: ["old-root"],
        })}
      />
    ));

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
  });

  it("shows runtime status without an expansion control for leaf titles", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <SessionTreeItem
          session={session("running", "Running")}
          status="running"
          hasChildren={false}
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
    expect(
      host.querySelector('[aria-label="Running, Running"]')?.hasAttribute("aria-expanded"),
    ).toBe(false);
    expect(host.querySelector(".shell-session-disclosure")).toBeNull();
    expect(host.querySelector(".shell-session-status")?.getAttribute("data-status")).toBe(
      "running",
    );
    expect(host.querySelector(".shell-session-status")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".shell-session-status")?.parentElement?.className).toBe(
      "shell-session-row-end",
    );
    expect(host.querySelector('[aria-label="Delete Running"]')?.parentElement?.className).toBe(
      "shell-session-row-end",
    );

    dispose();
  });

  it("places a delete action at the end of each session row", () => {
    const onDelete = vi.fn<(sessionID: string, opener: HTMLButtonElement) => void>();
    const { host, dispose } = mount(() => (
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
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Delete One"]');
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(button?.parentElement?.lastElementChild).toBe(button);
    button?.click();
    expect(onDelete).toHaveBeenCalledWith("one", button);

    dispose();
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
    const { host, dispose } = mount(() => (
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
    ));

    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter sessions"]');
    expect(filter).not.toBeNull();
    expect(filter?.placeholder).toBe("Filter sessions");
    inputEvent(filter!, "match");

    expect(host.querySelector('[aria-label="Project work, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Architecture notes, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Deep MATCH result, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Personal notes, Idle"]')).toBeNull();
    expect(host.querySelector('[aria-label="Unrelated child, Idle"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Project work, Idle"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      host.querySelector('[aria-label="Architecture notes, Idle"]')?.getAttribute("aria-expanded"),
    ).toBe("true");

    dispose();
  });

  it("clearing the filter restores controlled expansion and reports no matches distinctly", () => {
    const { host, dispose } = mount(() => (
      <SessionSidebar
        {...sidebarProps({
          sessions: [session("root", "Root"), session("child", "Matching child", "root")],
          expandedIDs: [],
        })}
      />
    ));
    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter sessions"]');
    expect(filter).not.toBeNull();

    inputEvent(filter!, "does-not-exist");
    expect(host.textContent).toContain("No sessions match");
    expect(host.textContent).not.toContain("No sessions yet.");

    inputEvent(filter!, "matching");
    expect(host.querySelector('[aria-label="Matching child, Idle"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Root, Idle"]')?.getAttribute("aria-expanded")).toBe(
      "true",
    );

    inputEvent(filter!, "");
    expect(host.querySelector('[aria-label="Root, Idle"]')?.getAttribute("aria-expanded")).toBe(
      "false",
    );

    dispose();
  });

  it("keeps a selected parent's forced expansion while filtering", () => {
    const onToggleExpanded = vi.fn<(sessionID: string) => void>();
    const { host, dispose } = mount(() => (
      <SessionSidebar
        {...sidebarProps({
          sessions: [session("root", "Root"), session("child", "Matching child", "root")],
          selectedID: "root",
          expandedIDs: [],
          onToggleExpanded,
        })}
      />
    ));

    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter sessions"]');
    inputEvent(filter!, "matching");

    const root = host.querySelector<HTMLButtonElement>('[aria-label="Root, Idle"]');
    expect(root?.getAttribute("aria-expanded")).toBe("true");
    root?.click();
    expect(onToggleExpanded).not.toHaveBeenCalled();
    expect(root?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[aria-label="Matching child, Idle"]')).not.toBeNull();

    dispose();
  });

  it("labels idle and running sessions from runtime status", () => {
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

    expect(host.querySelector('[aria-label="Running, Running"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Idle, Idle"]')).not.toBeNull();

    dispose();
  });

  it("places the create action at the top of the session list", () => {
    const host = document.createElement("div");
    const dispose = render(() => <SessionSidebar {...sidebarProps()} />, host);

    const sidebar = host.querySelector(".shell-session-sidebar");
    expect(sidebar?.firstElementChild?.classList.contains("shell-session-header")).toBe(true);
    expect(
      sidebar?.firstElementChild?.querySelector('[aria-label="Create session"]'),
    ).not.toBeNull();

    dispose();
  });
});

describe("session attention indicators", () => {
  it("shows an accessible blue-dot state in place of the spinner for pending input", () => {
    const { host, dispose } = mount(() => (
      <SessionTreeItem
        session={session("waiting", "Waiting")}
        status="running"
        attention={{ kind: "permission", origin: "session" }}
        hasChildren={false}
        selected={false}
        expanded={false}
        deleteDisabled
        onSelect={() => undefined}
        onToggleExpanded={() => undefined}
        onDelete={() => undefined}
      />
    ));
    expect(host.querySelector('[aria-label="Waiting, Permission required"]')).not.toBeNull();
    expect(host.querySelector(".shell-session-attention-dot")).not.toBeNull();
    expect(host.querySelector('[data-component="loader-v2"]')).toBeNull();
    expect(host.querySelector(".shell-session-status")?.parentElement?.className).toBe(
      "shell-session-row-end",
    );
    dispose();
  });

  it("rolls a collapsed descendant's permission up to every ancestor row", () => {
    const { host, dispose } = mount(() => (
      <SessionTree
        sessions={[
          session("root", "Root"),
          session("child", "Child", "root"),
          session("grandchild", "Grandchild", "child"),
        ]}
        statusForSession={() => "running"}
        expandedIDs={[]}
        canDelete
        deletionStatusForSession={() => "ready"}
        attentionForSession={(id) => (id === "grandchild" ? "permission" : undefined)}
        onSelect={() => undefined}
        onToggleExpanded={() => undefined}
        onDelete={() => undefined}
      />
    ));

    expect(host.querySelector('[aria-label="Root, Subagent permission required"]')).not.toBeNull();
    expect(host.querySelectorAll(".shell-session-attention-dot")).toHaveLength(1);
    dispose();
  });

  it("prefers a descendant's permission over the row's own question", () => {
    const { host, dispose } = mount(() => (
      <SessionTree
        sessions={[session("root", "Root"), session("child", "Child", "root")]}
        statusForSession={() => "idle"}
        expandedIDs={["root"]}
        canDelete
        deletionStatusForSession={() => "ready"}
        attentionForSession={(id) => (id === "child" ? "permission" : "question")}
        onSelect={() => undefined}
        onToggleExpanded={() => undefined}
        onDelete={() => undefined}
      />
    ));

    expect(host.querySelector('[aria-label="Root, Subagent permission required"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Child, Permission required"]')).not.toBeNull();
    dispose();
  });

  it("keeps a pending descendant's attention visible while searching", () => {
    const { host, dispose } = mount(() => (
      <SessionTree
        sessions={[session("root", "Root"), session("child", "Unrelated name", "root")]}
        statusForSession={() => "idle"}
        expandedIDs={[]}
        query="Root"
        canDelete
        deletionStatusForSession={() => "ready"}
        attentionForSession={(id) => (id === "child" ? "permission" : undefined)}
        onSelect={() => undefined}
        onToggleExpanded={() => undefined}
        onDelete={() => undefined}
      />
    ));

    expect(host.querySelector('[aria-label="Root, Subagent permission required"]')).not.toBeNull();
    dispose();
  });
});
