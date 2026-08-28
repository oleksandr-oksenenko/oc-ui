import { createSignal } from "solid-js";
import type { SessionInfo } from "@opencode-ai/client";
import type { Meta } from "storybook-solidjs-vite";

import {
  SessionSidebar,
  type SessionSidebarProps,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";
import { storySession } from "./session-fixtures.ts";

const flatSessions: readonly SessionInfo[] = [
  storySession("one", "Implement session tree"),
  storySession("two", "Review API contract"),
  storySession("three", "Waiting for a decision"),
];

const hierarchySessions: readonly SessionInfo[] = [
  storySession("level-1", "Level one"),
  storySession("level-2", "Level two", "level-1"),
  storySession("level-3", "Level three", "level-2"),
  storySession("level-4", "Level four", "level-3"),
  storySession("sibling", "Sibling session"),
];

const meta = {
  title: "Sessions/SessionSidebar",
  component: SessionSidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionSidebar>;

export default meta;
type StoryOptions = Partial<Pick<SessionSidebarProps, "loading" | "error" | "canCreate">> & {
  readonly selectedID?: string;
  readonly expandedIDs?: readonly string[];
  readonly runningIDs?: readonly string[];
};

function interactiveSidebar(sessions: readonly SessionInfo[], options: StoryOptions = {}) {
  const [selectedID, setSelectedID] = createSignal(options.selectedID ?? sessions[0]?.id);
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>(options.expandedIDs ?? []);

  return (
    <div style={{ width: "200px", height: "560px", background: "#090909" }}>
      <SessionSidebar
        sessions={sessions}
        statusForSession={(id) => (options.runningIDs?.includes(id) ? "running" : "idle")}
        selectedID={selectedID()}
        expandedIDs={expandedIDs()}
        loading={options.loading ?? false}
        error={options.error}
        canCreate={options.canCreate ?? true}
        canDelete
        serverName="Local server"
        serverStatus="connected"
        onSelect={setSelectedID}
        onToggleExpanded={(id) =>
          setExpandedIDs((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onDelete={() => undefined}
        onCreate={() => setSelectedID("new-session")}
        onRetry={() => undefined}
        onSelectServer={() => undefined}
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

export const StatusGlyphs = {
  render: () =>
    interactiveSidebar(
      [storySession("idle", "Idle session"), storySession("running", "Running session")],
      { runningIDs: ["running"] },
    ),
};
