import { createSignal } from "solid-js";
import type { SessionInfo } from "@opencode-ai/client";
import type { Meta } from "storybook-solidjs-vite";

import {
  SessionSidebar,
  type SessionSidebarProps,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
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
        width: options.width ?? "240px",
        height: options.height ?? "560px",
        background: "#090909",
      }}
    >
      <SessionSidebar
        sessions={visibleSessions()}
        statusForSession={(id) => (options.runningIDs?.includes(id) ? "running" : "idle")}
        selectedID={selectedID()}
        expandedIDs={expandedIDs()}
        loading={options.loading ?? false}
        error={options.error}
        canCreate={options.canCreate ?? true}
        canDelete={options.canDelete ?? true}
        showHeader={options.showHeader}
        serverName="Local server"
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
  render: () =>
    interactiveSidebar(hierarchySessions, {
      selectedID: "level-5",
      expandedIDs: ["level-1", "level-2", "level-3", "level-4"],
      runningIDs: ["level-5"],
      height: "100vh",
      width: "360px",
    }),
};

export const DisclosureGutterAlignment = {
  render: () =>
    interactiveSidebar(disclosureGutterSessions, {
      selectedID: "parent",
      expandedIDs: ["parent", "child", "grandchild", "great-grandchild"],
      height: "320px",
      width: "360px",
    }),
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
    <div style={{ width: "320px", height: "640px", background: "#090909" }}>
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
