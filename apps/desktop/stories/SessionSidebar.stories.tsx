import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import {
  SessionSidebar,
  type SessionNode,
  type SessionSidebarProps,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";

const flatNodes: readonly SessionNode[] = [
  { id: "one", title: "Implement session tree", status: "idle" },
  { id: "two", title: "Review API contract", status: "running" },
  { id: "three", title: "Waiting for a decision", status: "idle", needsInput: true },
];

const hierarchyNodes: readonly SessionNode[] = [
  {
    id: "level-1",
    title: "Level one",
    status: "idle",
    children: [
      {
        id: "level-2",
        title: "Level two",
        status: "idle",
        children: [
          {
            id: "level-3",
            title: "Level three",
            status: "running",
            children: [{ id: "level-4", title: "Level four", status: "idle", needsInput: true }],
          },
        ],
      },
    ],
  },
  { id: "sibling", title: "Sibling session", status: "idle" },
];

const meta = {
  title: "Sessions/SessionSidebar",
  component: SessionSidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionSidebar>;

export default meta;
type StoryOptions = Partial<
  Pick<SessionSidebarProps, "loading" | "error" | "canCreate" | "creating">
> & {
  readonly selectedID?: string;
  readonly expandedIDs?: readonly string[];
};

function interactiveSidebar(nodes: readonly SessionNode[], options: StoryOptions = {}) {
  const [selectedID, setSelectedID] = createSignal(options.selectedID ?? nodes[0]?.id);
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>(options.expandedIDs ?? []);

  return (
    <div style={{ width: "200px", height: "560px", background: "#090909" }}>
      <SessionSidebar
        nodes={nodes}
        selectedID={selectedID()}
        expandedIDs={expandedIDs()}
        loading={options.loading ?? false}
        error={options.error}
        canCreate={options.canCreate ?? true}
        creating={options.creating ?? false}
        serverName="Local server"
        serverStatus="connected"
        onSelect={setSelectedID}
        onToggleExpanded={(id) =>
          setExpandedIDs((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onCreate={() => setSelectedID("new-session")}
        onRetry={() => undefined}
        onHide={() => undefined}
        onSelectServer={() => undefined}
      />
    </div>
  );
}

export const FlatProductionList = {
  render: () => interactiveSidebar(flatNodes),
};

export const FourLevelHierarchy = {
  render: () => interactiveSidebar(hierarchyNodes),
};

export const ExpandedDeepHierarchy = {
  render: () =>
    interactiveSidebar(hierarchyNodes, {
      selectedID: "level-4",
      expandedIDs: ["level-1", "level-2", "level-3"],
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

export const Creating = {
  render: () => interactiveSidebar(flatNodes, { creating: true }),
};

export const StatusGlyphs = {
  render: () =>
    interactiveSidebar([
      { id: "idle", title: "Idle session", status: "idle" },
      { id: "running", title: "Running session", status: "running" },
      { id: "input", title: "Needs input", status: "running", needsInput: true },
      { id: "creating", title: "Creating session", status: "creating" },
    ]),
};

export const SelectedNeedsInputPrecedence = {
  render: () =>
    interactiveSidebar(
      [
        {
          id: "parent",
          title: "Running parent",
          status: "running",
          children: [{ id: "child", title: "Needs input", status: "running", needsInput: true }],
        },
      ],
      { selectedID: "child", expandedIDs: ["parent"] },
    ),
};
