import { createSignal } from "solid-js";
import type { Decorator, Meta, StoryObj } from "storybook-solidjs-vite";

import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/DiffView/DiffFile.tsx";

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

export const Diff: Story = {
  args: {
    diff: { files: diffFiles, loading: false },
  },
};

export const Loading: Story = {
  args: {
    diff: {
      files: [],
      loading: true,
      comparison: "working",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes vs main" },
      ],
    },
  },
};

export const NoSession: Story = {
  args: {
    diff: {
      files: [],
      loading: false,
      emptyMessage: "Select a session to view changes",
      emptyDescription: "The Diff panel follows the selected session's workspace location.",
    },
  },
};

export const Empty: Story = {
  args: {
    diff: { files: [], loading: false },
  },
};

export const Unavailable: Story = {
  args: {
    diff: {
      files: [],
      loading: false,
      emptyMessage: "Diff unavailable",
      emptyDescription: "OpenCode diff data is not connected yet.",
    },
  },
};

export const Error: Story = {
  args: {
    diff: { files: [], loading: false, error: "The working tree could not be read." },
  },
};

export const Refreshing: Story = {
  args: {
    diff: { files: diffFiles, loading: true, stale: true },
  },
};

export const RefreshError: Story = {
  args: {
    diff: {
      files: diffFiles,
      loading: false,
      stale: true,
      error: "The latest changes could not be loaded.",
      onRetry: () => undefined,
    },
  },
};

export const CachedStale: Story = {
  args: {
    diff: { files: diffFiles, loading: false, stale: true },
  },
};

export const BranchEmpty: Story = {
  args: {
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
  },
};

export const DiffEdgeCases: Story = {
  args: {
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
  },
};

export const ComparisonControl: Story = {
  args: {
    diff: { files: diffFiles, loading: false },
  },
  render: () => {
    const [comparison, setComparison] = createSignal("working");
    return (
      <ContextPanel
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
      />
    );
  },
};

export const NoClose: Story = {
  args: {
    onClose: undefined,
    diff: { files: diffFiles, loading: false },
  },
};
