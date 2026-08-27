import { createSignal } from "solid-js";
import type { Decorator, Meta, StoryObj } from "storybook-solidjs-vite";

import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel.tsx";
import type { ContextPanelProps } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel.tsx";
import type { ContextPanelTab } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/ContextTabs.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/DiffView/DiffFile.tsx";
import type { FileTreeNode } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/FilesView/FileTreeItem.tsx";

const diffFiles: readonly DiffFileData[] = [
  {
    path: "src/renderer/components/Workspace.tsx",
    additions: 3,
    deletions: 1,
    status: "modified",
    defaultExpanded: true,
    patch: `diff --git a/src/renderer/components/Workspace.tsx b/src/renderer/components/Workspace.tsx
--- a/src/renderer/components/Workspace.tsx
+++ b/src/renderer/components/Workspace.tsx
@@ -28,3 +28,4 @@
   const columns = createMemo(() => layout());
-  return <main class="workspace">
+  return <main class="workspace" data-layout={columns()}>
+    <ContextPanel {...context} />
   </main>;
`,
  },
  {
    path: "src/renderer/styles.css",
    additions: 1,
    deletions: 0,
    status: "added",
    defaultExpanded: true,
    patch: `diff --git a/src/renderer/styles.css b/src/renderer/styles.css
new file mode 100644
--- /dev/null
+++ b/src/renderer/styles.css
@@ -0,0 +1 @@
+.workspace { grid-template-columns: 270px minmax(0, 1fr) 360px; }
`,
  },
];

const fileNodes: readonly FileTreeNode[] = [
  {
    id: "src",
    name: "src",
    kind: "directory",
    children: [
      {
        id: "src/renderer",
        name: "renderer",
        kind: "directory",
        children: [
          { id: "src/renderer/App.tsx", name: "App.tsx", kind: "file", status: "modified" },
          {
            id: "src/renderer/Workspace.tsx",
            name: "Workspace.tsx",
            kind: "file",
            status: "added",
          },
        ],
      },
      { id: "src/main.ts", name: "main.ts", kind: "file" },
    ],
  },
  { id: "package.json", name: "package.json", kind: "file", status: "modified" },
  { id: "README.md", name: "README.md", kind: "file" },
];

const baseFiles: ContextPanelProps["files"] = {
  nodes: fileNodes,
  loading: false,
  expandedIDs: ["src", "src/renderer"],
  onToggleExpanded: () => undefined,
};

const meta = {
  title: "Context/ContextPanel",
  component: ContextPanel,
  args: { onClose: () => undefined },
  parameters: { layout: "centered" },
  decorators: [
    ((Story) => (
      <div style={{ width: "520px", height: "620px", display: "flex", "align-items": "stretch" }}>
        <Story />
      </div>
    )) satisfies Decorator,
  ],
} satisfies Meta<typeof ContextPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

const noopTabChange = (_tab: ContextPanelTab): void => undefined;

export const Diff: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
};

export const Files: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
};

export const Loading: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: [],
      loading: true,
      comparison: "working",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes vs main" },
      ],
    },
    files: { ...baseFiles, loading: true, nodes: [] },
  },
};

export const NoSession: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: [],
      loading: false,
      emptyMessage: "Select a session to view changes",
      emptyDescription: "The Diff panel follows the selected session's workspace location.",
    },
    files: baseFiles,
  },
};

export const FilesLoading: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: { ...baseFiles, loading: true, nodes: [] },
  },
};

export const Empty: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: [], loading: false },
    files: { ...baseFiles, nodes: [] },
  },
};

export const Unavailable: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: [],
      loading: false,
      emptyMessage: "Diff unavailable",
      emptyDescription: "OpenCode diff data is not connected yet.",
    },
    files: {
      ...baseFiles,
      nodes: [],
      emptyMessage: "Files unavailable",
      emptyDescription: "OpenCode file data is not connected yet.",
    },
  },
};

export const FilesEmpty: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: { ...baseFiles, nodes: [] },
  },
};

export const Error: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: [], loading: false, error: "The working tree could not be read." },
    files: { ...baseFiles, error: "The file tree could not be read." },
  },
};

export const Refreshing: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: true, stale: true },
    files: baseFiles,
  },
};

export const RefreshError: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: diffFiles,
      loading: false,
      stale: true,
      error: "The latest changes could not be loaded.",
      onRetry: () => undefined,
    },
    files: baseFiles,
  },
};

export const CachedStale: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false, stale: true },
    files: baseFiles,
  },
};

export const BranchEmpty: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: [],
      loading: false,
      comparison: "branch",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes vs main" },
      ],
      emptyMessage: "No changes against main",
      emptyDescription: "The working copy matches its merge base with main.",
    },
    files: baseFiles,
  },
};

export const FilesError: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: {
      ...baseFiles,
      error: "The file tree could not be read.",
      onRetry: () => undefined,
    },
  },
};

export const DiffEdgeCases: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: {
      files: [
        {
          path: "src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/very-long-file-name.tsx",
          additions: 0,
          deletions: 2,
          status: "deleted",
          defaultExpanded: false,
          patch: `diff --git a/src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/very-long-file-name.tsx b/src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/very-long-file-name.tsx
deleted file mode 100644
--- a/src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/very-long-file-name.tsx
+++ /dev/null
@@ -40,2 +0,0 @@
-  const obsolete = true;
-  return obsolete;
`,
        },
        {
          path: "README.md",
          additions: 0,
          deletions: 0,
          status: "modified",
          defaultExpanded: true,
          patch: "",
        },
      ],
      loading: false,
    },
    files: baseFiles,
  },
};

export const FilesEdgeCases: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: {
      ...baseFiles,
      expandedIDs: ["src"],
      nodes: [
        { id: "empty", name: "empty-folder", kind: "directory", children: [] },
        { id: "deleted", name: "removed.ts", kind: "file", status: "deleted" },
      ],
    },
  },
};

export const ComparisonControl: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
  render: () => {
    const [comparison, setComparison] = createSignal("working");
    return (
      <ContextPanel
        activeTab="diff"
        onTabChange={noopTabChange}
        diff={{
          files: diffFiles,
          loading: false,
          comparison: comparison(),
          comparisonOptions: [
            { value: "working", label: "Working changes" },
            { value: "branch", label: "Changes vs main" },
          ],
          onComparisonChange: setComparison,
        }}
        files={baseFiles}
      />
    );
  },
};

export const NoClose: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    onClose: undefined,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
};

export const ControlledTabAndExpansion: Story = {
  args: {
    activeTab: "files",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
  render: () => {
    const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("files");
    const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>(["src"]);

    const toggleExpanded = (id: string): void => {
      setExpandedIDs((current) =>
        current.includes(id) ? current.filter((expandedID) => expandedID !== id) : [...current, id],
      );
    };

    return (
      <ContextPanel
        activeTab={activeTab()}
        onTabChange={(tab) => setActiveTab(tab)}
        diff={{ files: diffFiles, loading: false }}
        files={{ ...baseFiles, expandedIDs: expandedIDs(), onToggleExpanded: toggleExpanded }}
      />
    );
  },
};
