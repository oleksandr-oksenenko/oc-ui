/* oxlint-disable effecttsgo/async-function -- Storybook interaction tests use Promise APIs. */
import { createSignal } from "solid-js";
import type { Project, SessionInfo } from "@opencode/client";
import { expect, userEvent, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import {
  SessionSidebar,
  type SessionSidebarProps,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { sessionSubtreeIDs } from "../src/renderer/components/App/ConnectedApp/Sessions/session-selection.ts";
import { storySession } from "./session-fixtures.ts";

const storyNow = Date.UTC(2026, 7, 29, 12, 0, 0);
const day = 24 * 60 * 60 * 1000;

function updated(session: SessionInfo, timestamp: number): SessionInfo {
  return { ...session, time: { ...session.time, updated: timestamp } };
}

const flatSessions: readonly SessionInfo[] = [
  updated(storySession("one", "Implement session tree"), storyNow - 60 * 60 * 1000),
  updated(storySession("two", "Review API contract"), storyNow - 2 * day),
  updated(storySession("three", "Waiting for a decision"), storyNow - 12 * day),
];

const hierarchySessions: readonly SessionInfo[] = [
  updated(storySession("level-1", "Workspace migration"), storyNow - 12 * day),
  updated(storySession("level-2", "Plan the migration", "level-1"), storyNow - 10 * day),
  updated(storySession("level-3", "Implement the plan", "level-2"), storyNow - 7 * day),
  updated(storySession("level-4", "Review the implementation", "level-3"), storyNow - 2 * day),
  updated(storySession("level-5", "Verify the result", "level-4"), storyNow - 60 * 60 * 1000),
  updated(storySession("sibling", "Sibling session"), storyNow - 3 * day),
  updated(storySession("earlier", "Earlier investigation"), storyNow - 12 * day),
];

const disclosureGutterSessions: readonly SessionInfo[] = [
  updated(storySession("parent", "Casual check-in"), storyNow - 60 * 60 * 1000),
  updated(storySession("child", "Verify test change file", "parent"), storyNow - 60 * 60 * 1000),
  updated(storySession("grandchild", "Inspect failure output", "child"), storyNow - 60 * 60 * 1000),
  updated(
    storySession("great-grandchild", "Adjust session tree spacing", "grandchild"),
    storyNow - 60 * 60 * 1000,
  ),
  updated(
    storySession("deepest", "Confirm nested alignment", "great-grandchild"),
    storyNow - 60 * 60 * 1000,
  ),
];

const selectBeforeToggleSessions: readonly SessionInfo[] = [
  updated(storySession("other", "Other session"), storyNow - 30 * 60 * 1000),
  updated(storySession("parent", "Parent session"), storyNow - 2 * 60 * 60 * 1000),
  updated(storySession("child", "Child session", "parent"), storyNow - 3 * 60 * 60 * 1000),
];

const longContentSessions: readonly SessionInfo[] = [
  updated(
    storySession(
      "long-parent",
      "Investigate a deeply nested renderer regression with a very long session title",
    ),
    storyNow - 60 * 60 * 1000,
  ),
  updated(
    storySession(
      "long-child",
      "Compare the complete server-provided workspace location without truncating its meaning",
      "long-parent",
    ),
    storyNow - 2 * 60 * 60 * 1000,
  ),
];

const identityProjects: readonly Project[] = [
  {
    id: "storybook",
    canonical: "/srv/products/renderer-with-a-very-long-project-directory",
    name: "Renderer with an unusually long project name",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  },
  {
    id: "drive",
    canonical: "D:\\teams\\frontend\\app",
    name: "App",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  },
  {
    id: "unc",
    canonical: "\\\\build-host\\shared-projects\\app",
    name: "App",
    time: { created: 1, updated: 1 },
    sandboxes: [],
  },
];
const identitySessions: readonly SessionInfo[] = [
  {
    ...longContentSessions[0]!,
    location: { directory: "/srv/worktrees/fix/packages/renderer", workspaceID: "remote-posix" },
  },
  {
    ...longContentSessions[1]!,
    projectID: "drive",
    location: { directory: "D:\\worktrees\\fix\\ui", workspaceID: "remote-windows" },
  },
  {
    ...updated(storySession("unc", "Inspect a shared project", "long-child"), storyNow),
    projectID: "unc",
    location: { directory: "\\\\build-host\\shared-projects\\app" },
  },
  {
    ...updated(storySession("unknown", "Unregistered project"), storyNow),
    projectID: "missing",
    location: { directory: "//remote/share/unregistered-project/", workspaceID: "remote-unc" },
  },
  {
    ...updated(storySession("global", "Outside a repository"), storyNow),
    projectID: "global",
    location: { directory: "/" },
  },
];

const meta = {
  title: "Sessions/SessionSidebar",
  component: SessionSidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionSidebar>;

export default meta;
type StoryOptions = Partial<
  Pick<
    SessionSidebarProps,
    "loading" | "error" | "canCreate" | "canDelete" | "showHeader" | "drafts" | "projects"
  >
> & {
  readonly selectedID?: string;
  readonly expandedIDs?: readonly string[];
  readonly runningIDs?: readonly string[];
  readonly serverStatus?: SessionSidebarProps["serverStatus"];
  readonly serverName?: string;
  readonly autoFocusClose?: boolean;
  readonly showHideAction?: boolean;
  readonly height?: string;
  readonly width?: string;
};

function interactiveSidebar(sessions: readonly SessionInfo[], options: StoryOptions = {}) {
  const [selectedID, setSelectedID] = createSignal(options.selectedID ?? sessions[0]?.id);
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>(options.expandedIDs ?? []);
  const [visibleSessions, setVisibleSessions] = createSignal(sessions);
  const [serverStatus, setServerStatus] = createSignal<SessionSidebarProps["serverStatus"]>(
    options.serverStatus ?? "connected",
  );
  const [nextSessionNumber, setNextSessionNumber] = createSignal(1);

  const deleteSession = (sessionID: string) => {
    const removed = new Set([sessionID]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of visibleSessions()) {
        if (
          candidate.parentID !== undefined &&
          removed.has(candidate.parentID) &&
          !removed.has(candidate.id)
        ) {
          removed.add(candidate.id);
          changed = true;
        }
      }
    }
    setVisibleSessions((current) => current.filter((candidate) => !removed.has(candidate.id)));
    const selected = selectedID();
    if (selected !== undefined && removed.has(selected)) setSelectedID(undefined);
  };

  const createSession = () => {
    const number = nextSessionNumber();
    const created = updated(storySession(`new-${number}`, "Untitled session"), storyNow + number);
    setNextSessionNumber(number + 1);
    setVisibleSessions((current) => [created, ...current]);
    setSelectedID(created.id);
  };

  return (
    <div
      style={{
        width: options.width ?? "220px",
        height: options.height ?? "560px",
        background: "var(--oc-surface-raised)",
      }}
    >
      <SessionSidebar
        projects={options.projects}
        drafts={options.drafts}
        sessions={visibleSessions()}
        now={storyNow}
        statusForSession={(id) => (options.runningIDs?.includes(id) ? "running" : "idle")}
        selectedID={selectedID()}
        expandedIDs={expandedIDs()}
        loading={options.loading ?? false}
        error={options.error}
        canCreate={options.canCreate ?? true}
        canDelete={options.canDelete ?? true}
        deletionStatusForSession={(id) =>
          sessionSubtreeIDs(id, visibleSessions()).every(
            (sessionID) => !options.runningIDs?.includes(sessionID),
          )
            ? "ready"
            : "running"
        }
        showHeader={options.showHeader}
        autoFocusClose={options.autoFocusClose}
        serverName={options.serverName ?? "Local server"}
        serverStatus={serverStatus()}
        onSelect={setSelectedID}
        onToggleExpanded={(id) =>
          setExpandedIDs((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onDelete={deleteSession}
        onCreate={createSession}
        onRetry={() => setServerStatus("connected")}
        onHide={options.showHideAction ? () => undefined : undefined}
        onSelectServer={() =>
          setServerStatus((current) => (current === "connected" ? "reconnecting" : "connected"))
        }
      />
    </div>
  );
}

export const FlatProductionList = {
  render: () => interactiveSidebar(flatSessions, { runningIDs: ["two"] }),
};

export const CollapsibleTimeGroups = {
  render: () =>
    interactiveSidebar(hierarchySessions, {
      selectedID: "level-4",
      expandedIDs: ["level-1", "level-2", "level-3"],
    }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const today = () => canvas.getByRole("button", { name: "Today" });
    const earlier = () => canvas.getByRole("button", { name: "Earlier" });
    const selected = () => canvas.getByRole("button", { name: "Review the implementation, Idle" });
    await expect(today()).toHaveAttribute("aria-expanded", "true");
    await expect(earlier()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(earlier());
    await expect(earlier()).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("button", { name: "Earlier investigation, Idle" })).toBeNull();
    await expect(selected()).toHaveAttribute("aria-current", "page");

    today().focus();
    await userEvent.keyboard("{Enter}");
    await expect(today()).toHaveFocus();
    await expect(today()).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("button", { name: "Workspace migration, Idle" })).toBeNull();
    await userEvent.keyboard(" ");
    await expect(today()).toHaveAttribute("aria-expanded", "true");
    await expect(selected()).toHaveAttribute("aria-current", "page");
    await expect(
      canvas.getByRole("button", { name: "Collapse Implement the plan" }),
    ).toHaveAttribute("aria-expanded", "true");

    const filter = canvas.getByRole("textbox", { name: "Filter sessions" });
    await userEvent.type(filter, "Earlier investigation");
    await expect(earlier()).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("button", { name: "Earlier investigation, Idle" })).toBeVisible();
    await userEvent.clear(filter);
    await expect(earlier()).toHaveAttribute("aria-expanded", "false");
    await expect(selected()).toHaveAttribute("aria-current", "page");
  },
};

export const CollapsibleTimeGroupsDark = {
  ...CollapsibleTimeGroups,
  globals: { theme: "dark" },
};

export const FourLevelHierarchy = {
  render: () => interactiveSidebar(hierarchySessions, { runningIDs: ["level-3"] }),
};

export const ExpandedDeepHierarchy = {
  render: () =>
    interactiveSidebar(hierarchySessions, {
      selectedID: "level-4",
      expandedIDs: ["level-1", "level-2", "level-3"],
      runningIDs: ["level-3"],
    }),
};

export const FilterableDeepHierarchy = {
  parameters: {
    docs: {
      description: {
        story:
          "Visual and accessibility fixture with filtering available for manual exploration. Automated filtering and ancestor visibility are covered by SessionTree tests.",
      },
    },
  },
  render: () =>
    interactiveSidebar(hierarchySessions, {
      selectedID: "level-5",
      expandedIDs: ["level-1", "level-2", "level-3", "level-4"],
      runningIDs: ["level-5"],
      height: "100vh",
      width: "220px",
    }),
};

export const DisclosureGutterAlignment = {
  render: () =>
    interactiveSidebar(disclosureGutterSessions, {
      selectedID: "parent",
      expandedIDs: ["parent", "child", "grandchild", "great-grandchild"],
      height: "320px",
      width: "220px",
    }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const parent = canvas.getByRole("button", { name: "Casual check-in, Idle" });
    const disclosure = canvas.getByRole("button", { name: "Collapse Casual check-in" });
    await userEvent.click(parent);
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByRole("button", { name: "Verify test change file, Idle" }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const child = canvas.getByRole("button", { name: "Verify test change file, Idle" });
    const childDisclosure = canvas.getByRole("button", {
      name: "Collapse Verify test change file",
    });
    await expect(child).toBeVisible();
    await userEvent.click(child);
    await expect(child).toHaveAttribute("aria-current", "page");
    await expect(childDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(child);
    await expect(childDisclosure).toHaveAttribute("aria-expanded", "false");
  },
};

export const ParentSelectionBeforeToggle = {
  render: () => interactiveSidebar(selectBeforeToggleSessions, { selectedID: "other" }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const parent = canvas.getByRole("button", { name: "Parent session, Idle" });
    const disclosure = canvas.getByRole("button", { name: "Expand Parent session" });
    const child = () => canvas.queryByRole("button", { name: "Child session, Idle" });

    await expect(parent).not.toHaveAttribute("aria-current", "page");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();

    await userEvent.click(parent);
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();

    await userEvent.click(parent);
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(child()).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Other session, Idle" }));
    await expect(parent).not.toHaveAttribute("aria-current", "page");

    parent.focus();
    await userEvent.keyboard("{Enter}");
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(child()).toBeVisible();

    await userEvent.keyboard("{Enter}");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();
  },
};

export const Loading = {
  render: () => interactiveSidebar([], { loading: true, canCreate: false }),
};

export const Empty = {
  render: () => interactiveSidebar([]),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const create = canvas.getByRole("button", { name: "New session" });
    create.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Untitled session, Idle" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.queryByText("No sessions yet.")).not.toBeInTheDocument();
  },
};

export const EmptyDisabled = {
  render: () => interactiveSidebar([], { canCreate: false, showHeader: false }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "New session" })).toBeDisabled();
  },
};

export const Error = {
  render: () =>
    interactiveSidebar([], { error: "Sessions could not be loaded.", canCreate: false }),
};

export const Reconnecting = {
  render: () => interactiveSidebar(flatSessions, { serverStatus: "reconnecting" }),
};

export const RunningWithDelete = {
  render: () =>
    interactiveSidebar(flatSessions, {
      selectedID: "two",
      runningIDs: ["two"],
    }),
};

export const HeaderHiddenMobile = {
  render: () => (
    <div style={{ width: "320px", height: "640px", background: "var(--oc-surface-raised)" }}>
      {interactiveSidebar(flatSessions, { showHeader: false })}
    </div>
  ),
};

export const StatusGlyphs = {
  render: () =>
    interactiveSidebar(
      [
        updated(storySession("idle", "Idle session"), storyNow - day),
        updated(storySession("running", "Running session"), storyNow - 60 * 60 * 1000),
      ],
      { runningIDs: ["running"] },
    ),
};

export const LongContentAtProductionWidth = {
  render: () =>
    interactiveSidebar(longContentSessions, {
      selectedID: "long-child",
      expandedIDs: ["long-parent"],
      runningIDs: ["long-parent"],
      serverName: "remote-development-server-with-a-long-hostname.example.internal:4096",
      width: "248px",
    }),
};

function projectIdentityStory(width: string) {
  return {
    render: () =>
      interactiveSidebar(identitySessions, {
        projects: identityProjects,
        selectedID: "long-child",
        expandedIDs: ["long-parent", "long-child"],
        runningIDs: ["long-parent"],
        width,
        height: "560px",
        drafts: {
          drafts: [
            {
              id: "chosen",
              title: "Draft for the renderer project",
              project: { id: "storybook", location: { directory: identityProjects[0]!.canonical } },
            },
            { id: "unchosen", title: "Draft without a project" },
          ],
          onSelect: () => undefined,
          onDelete: () => undefined,
        },
      }),
    play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      const rows = canvasElement.querySelectorAll<HTMLElement>(".shell-session-row");
      await expect(rows).toHaveLength(7);
      for (const row of rows) {
        const title = row.querySelector<HTMLElement>(".shell-session-title")!;
        const subtitle = row.querySelector<HTMLElement>(".shell-session-project")!;
        const main = row.querySelector<HTMLButtonElement>(".shell-session-main")!;
        await expect(subtitle.textContent?.length).toBeGreaterThan(0);
        await expect(subtitle.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          title.getBoundingClientRect().bottom,
        );
        await expect(subtitle.getBoundingClientRect().right).toBeLessThanOrEqual(
          row.getBoundingClientRect().right,
        );
        await expect(subtitle.clientHeight).toBe(16);
        await expect(main).toHaveAttribute("aria-description");
        const chevron = row.querySelector<HTMLElement>('[data-slot="collapsible-arrow"]');
        if (chevron) {
          const titleBounds = title.getBoundingClientRect();
          const chevronBounds = chevron.getBoundingClientRect();
          await expect(
            Math.abs(
              chevronBounds.top +
                chevronBounds.height / 2 -
                (titleBounds.top + titleBounds.height / 2),
            ),
          ).toBeLessThanOrEqual(0.5);
        }
        const remove = row.querySelector<HTMLButtonElement>(".shell-session-delete");
        if (remove) {
          const titleBounds = title.getBoundingClientRect();
          const removeBounds = remove.getBoundingClientRect();
          await expect(
            Math.abs(
              removeBounds.top +
                removeBounds.height / 2 -
                (titleBounds.top + titleBounds.height / 2),
            ),
          ).toBeLessThanOrEqual(0.5);
        }
      }
      const child = canvas.getByRole("button", {
        name: /Compare the complete server-provided workspace location.*Idle/,
      });
      await expect(child).toHaveAttribute("aria-current", "page");
      await expect(child.querySelector(".shell-session-project")).toHaveTextContent("App");
      await expect(child).toHaveAttribute("aria-description", "App");
      child.focus();
      await userEvent.keyboard("{Tab}");
      const remove = child
        .closest(".shell-session-row")!
        .querySelector<HTMLButtonElement>(".shell-session-delete")!;
      await expect(remove).toHaveFocus();
      await expect(getComputedStyle(remove).opacity).toBe("1");
      child.focus();
      await userEvent.keyboard("{Enter}");
      await expect(
        canvas.queryByRole("button", { name: "Inspect a shared project, Idle" }),
      ).not.toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      await expect(
        canvas.getByRole("button", { name: "Inspect a shared project, Idle" }),
      ).toBeVisible();
      const viewport = canvasElement.querySelector<HTMLElement>(".scroll-view__viewport")!;
      await expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    },
  };
}

export const ProjectIdentity = projectIdentityStory("248px");
export const ProjectIdentityDark = { ...projectIdentityStory("248px"), globals: { theme: "dark" } };
export const ProjectIdentityNarrow = {
  ...projectIdentityStory("196px"),
  globals: { viewport: { value: "narrow", isRotated: false } },
};
export const ProjectIdentityNarrowDark = {
  ...ProjectIdentityNarrow,
  globals: { theme: "dark", viewport: { value: "narrow", isRotated: false } },
};
export const ProjectIdentityMinimumWidth = {
  ...projectIdentityStory("172px"),
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const ProjectIdentityMinimumWidthDark = {
  ...ProjectIdentityMinimumWidth,
  globals: { theme: "dark", viewport: { value: "mobile", isRotated: false } },
};

export const FilterFocused = {
  render: () => interactiveSidebar(flatSessions),
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLInputElement>('input[aria-label="Filter sessions"]')?.focus();
  },
};

export const MobileCloseFocused = {
  render: () =>
    interactiveSidebar(flatSessions, {
      width: "220px",
      showHideAction: true,
      autoFocusClose: true,
    }),
};

export const ManyDrafts = {
  render: () =>
    interactiveSidebar(flatSessions, {
      drafts: {
        drafts: Array.from({ length: 30 }, (_, index) => ({
          id: `draft-${index}`,
          title: `Draft ${index + 1}`,
        })),
        onSelect: () => undefined,
        onDelete: () => undefined,
      },
    }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".scroll-view__viewport")!;
    const drafts = canvas.getByRole("region", { name: "Drafts" });
    const sessions = canvas.getByRole("navigation", { name: "Sessions" });
    await expect(viewport.contains(drafts)).toBe(true);
    await expect(viewport.contains(sessions)).toBe(true);
    await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    const footer = canvas.getByRole("button", { name: /Select server,/ });
    await expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByRole("complementary", { name: "Sessions" }).getBoundingClientRect().bottom,
    );
    sessions.scrollIntoView({ block: "end" });
    await expect(viewport.scrollTop).toBeGreaterThan(0);
    await expect(footer).toBeVisible();
  },
};
