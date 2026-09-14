/* oxlint-disable effecttsgo/async-function -- Storybook interaction tests use Promise APIs. */
import { createSignal } from "solid-js";
import type { SessionInfo } from "@opencode-ai/client";
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

const meta = {
  title: "Sessions/SessionSidebar",
  component: SessionSidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionSidebar>;

export default meta;
type StoryOptions = Partial<
  Pick<SessionSidebarProps, "loading" | "error" | "canCreate" | "canDelete" | "showHeader">
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
    await userEvent.click(parent);
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.queryByRole("button", { name: "Verify test change file, Idle" }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    const child = canvas.getByRole("button", { name: "Verify test change file, Idle" });
    await expect(child).toBeVisible();
    await userEvent.click(child);
    await expect(child).toHaveAttribute("aria-current", "page");
    await expect(child).toHaveAttribute("aria-expanded", "true");
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(child);
    await expect(child).toHaveAttribute("aria-expanded", "false");
  },
};

export const ParentSelectionBeforeToggle = {
  render: () => interactiveSidebar(selectBeforeToggleSessions, { selectedID: "other" }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const parent = canvas.getByRole("button", { name: "Parent session, Idle" });
    const child = () => canvas.queryByRole("button", { name: "Child session, Idle" });

    await expect(parent).not.toHaveAttribute("aria-current", "page");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();

    await userEvent.click(parent);
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();

    await userEvent.click(parent);
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await expect(child()).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Other session, Idle" }));
    await expect(parent).not.toHaveAttribute("aria-current", "page");

    parent.focus();
    await userEvent.keyboard("{Enter}");
    await expect(parent).toHaveAttribute("aria-current", "page");
    await expect(parent).toHaveAttribute("aria-expanded", "true");
    await expect(child()).toBeVisible();

    await userEvent.keyboard("{Enter}");
    await expect(parent).toHaveAttribute("aria-expanded", "false");
    await expect(child()).not.toBeInTheDocument();
  },
};

export const Loading = {
  render: () => interactiveSidebar([], { loading: true, canCreate: false }),
};

export const Empty = {
  render: () => interactiveSidebar([]),
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
    }),
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
