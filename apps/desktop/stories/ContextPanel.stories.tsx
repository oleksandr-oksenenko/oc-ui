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
    defaultExpanded: true,
    lines: [
      {
        kind: "context",
        oldLine: 28,
        newLine: 28,
        content: "  const columns = createMemo(() => layout());",
      },
      { kind: "deletion", oldLine: 29, content: '  return <main class="workspace">' },
      {
        kind: "addition",
        newLine: 29,
        content: '  return <main class="workspace" data-layout={columns()}>',
      },
      { kind: "addition", newLine: 30, content: "    <ContextPanel {...context} />" },
      { kind: "context", oldLine: 30, newLine: 31, content: "  </main>;" },
    ],
  },
  {
    path: "src/renderer/styles.css",
    additions: 1,
    deletions: 0,
    defaultExpanded: true,
    lines: [
      {
        kind: "addition",
        newLine: 74,
        content: ".workspace { grid-template-columns: 270px minmax(0, 1fr) 360px; }",
      },
    ],
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
      <div style={{ height: "620px", display: "flex", "align-items": "stretch" }}>
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
    diff: { files: [], loading: true },
    files: { ...baseFiles, loading: true, nodes: [] },
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
          defaultExpanded: false,
          lines: [
            { kind: "deletion", oldLine: 40, content: "  const obsolete = true;" },
            { kind: "deletion", oldLine: 41, content: "  return obsolete;" },
          ],
        },
        {
          path: "README.md",
          additions: 0,
          deletions: 0,
          defaultExpanded: true,
          lines: [{ kind: "context", oldLine: 1, newLine: 1, content: "# Context panel" }],
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

export const ScopeControl: Story = {
  args: {
    activeTab: "diff",
    onTabChange: noopTabChange,
    diff: { files: diffFiles, loading: false },
    files: baseFiles,
  },
  render: () => {
    const [scope, setScope] = createSignal("all");
    return (
      <ContextPanel
        activeTab="diff"
        onTabChange={noopTabChange}
        diff={{
          files: diffFiles,
          loading: false,
          scope: scope(),
          scopeOptions: [
            { value: "all", label: "All changes" },
            { value: "staged", label: "Staged changes" },
          ],
          onScopeChange: setScope,
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
