/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createMemo, createSignal } from "solid-js";
import type { Decorator, Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { SelectedLineRange } from "@pierre/diffs";

import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import type { ReviewComment } from "../src/renderer/domain/review-drafts.ts";

const diffFiles: readonly DiffFileData[] = [
  {
    file: "src/renderer/components/Workspace.tsx",
    additions: 3,
    deletions: 1,
    status: "modified",
    defaultExpanded: true,
    patch: `diff --git a/src/renderer/components/Workspace.tsx b/src/renderer/components/Workspace.tsx
--- a/src/renderer/components/Workspace.tsx
+++ b/src/renderer/components/Workspace.tsx
@@ -1,17 +1,19 @@
 import { createMemo } from "solid-js";
 import { ContextPanel } from "./ContextPanel";
 type WorkspaceProps = { ready: boolean };
 export function Workspace(props: WorkspaceProps) {
   const layout = () => "three-column";
   const columns = createMemo(() => layout());
   const isReady = () => props.ready;
   const theme = "dark";
   const compact = true;
   const details = "workspace details";
   const title = "Workspace";
   const subtitle = "Local project";
   if (!isReady()) return <p>Loading workspace</p>;
-  return <main class="workspace">
+  const className = "workspace";
+  return <main class={className} data-layout={columns()}>
+    <ContextPanel {...context} />
     {props.children}
   </main>;
 }
`,
  },
  {
    file: "src/renderer/styles.css",
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

const longPath =
  "src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DeeplyNestedFeatureWithAnIntentionallyLongFileName.tsx";

const meta = {
  title: "Context/ContextPanel",
  component: ContextPanel,
  args: { onClose: () => undefined },
  parameters: { layout: "centered" },
  decorators: [
    ((Story) => (
      <div
        style={{
          width: "min(360px, 100vw)",
          height: "620px",
          display: "flex",
          "align-items": "stretch",
        }}
      >
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
          file: "src/renderer/components/App/ConnectedApp/Changes/ContextPanel/very-long-file-name.tsx",
          additions: 0,
          deletions: 2,
          status: "deleted",
          defaultExpanded: false,
          patch: `diff --git a/src/renderer/components/App/ConnectedApp/Changes/ContextPanel/very-long-file-name.tsx b/src/renderer/components/App/ConnectedApp/Changes/ContextPanel/very-long-file-name.tsx
deleted file mode 100644
--- a/src/renderer/components/App/ConnectedApp/Changes/ContextPanel/very-long-file-name.tsx
+++ /dev/null
@@ -40,2 +0,0 @@
-  const obsolete = true;
-  return obsolete;
`,
        },
        {
          file: "README.md",
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

export const CollapseAll: Story = {
  args: {
    diff: { files: diffFiles, loading: false },
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("collapse every file", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Collapse all files" }));
      await expect(canvas.getByRole("button", { name: "Expand all files" })).toBeVisible();
      for (const file of diffFiles) {
        const toggle = await canvas.findByRole("button", { name: `Expand ${file.file}` });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
      }
    });

    await step("expand every file", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Expand all files" }));
      await expect(canvas.getByRole("button", { name: "Collapse all files" })).toBeVisible();
      for (const file of diffFiles) {
        const toggle = await canvas.findByRole("button", { name: `Collapse ${file.file}` });
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      }
    });
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

export const ReviewComments: Story = {
  args: {
    diff: { files: diffFiles, loading: false },
  },
  render: () => {
    const [editingCommentID, setEditingCommentID] = createSignal<string | undefined>("comment-1");
    const [body, setBody] = createSignal("Please keep this state controlled by the parent.");
    const selection: SelectedLineRange = {
      start: 14,
      side: "deletions",
      end: 16,
      endSide: "additions",
    };
    const comment = createMemo<ReviewComment>(() => ({
      id: "comment-1",
      path: diffFiles[0]!.file,
      body: body(),
      selection,
      selectedCode: "const previous = createMemo(() => current());\n",
    }));
    const view = createMemo(() => ({
      files: diffFiles,
      loading: false,
      review: {
        comments: [comment()],
        editingCommentID: editingCommentID(),
        selectedLines: { path: comment().path, range: selection },
        onUpdateCommentBody: (_id: string, nextBody: string) => setBody(nextBody),
        onEditComment: (commentID: string) => setEditingCommentID(commentID),
        onFinishComment: () => setEditingCommentID(undefined),
        onRemoveComment: () => setEditingCommentID(undefined),
      },
    }));
    return <ContextPanel diff={view()} />;
  },
};

export const NoClose: Story = {
  args: {
    onClose: undefined,
    diff: { files: diffFiles, loading: false },
  },
};

export const CloseFocused: Story = {
  args: {
    autoFocusClose: true,
    diff: { files: diffFiles, loading: false },
  },
};

const narrowViewport = {
  options: {
    narrow320: { name: "Narrow 320x720", styles: { width: "320px", height: "720px" } },
  },
};

export const NarrowLongPath: Story = {
  parameters: { viewport: narrowViewport },
  globals: { viewport: { value: "narrow320", isRotated: false } },
  args: {
    diff: {
      loading: false,
      comparison: "branch",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes against the long-lived release branch" },
      ],
      files: [
        {
          file: longPath,
          additions: 128,
          deletions: 47,
          status: "modified",
          defaultExpanded: false,
          patch: "",
        },
      ],
    },
  },
};

const rtlLeadingPath =
  "מסמכים-ארוכים-במיוחד-לטובת-הבדיקה/תת-תיקייה-נוספת-לבדיקה/very-long-file-name.tsx";

/** Report which end of the rendered path survives start truncation. */
function measurePathEdges(path: HTMLElement) {
  const text = path.querySelector("bdi")?.firstChild;
  const content = text?.textContent ?? "";
  const box = path.getBoundingClientRect();
  const visible = (index: number) => {
    if (!text || index < 0) return false;
    const range = document.createRange();
    range.setStart(text, index);
    range.setEnd(text, index + 1);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
  };
  return {
    truncated: path.scrollWidth > path.clientWidth,
    first: visible(0),
    last: visible(content.length - 1),
  };
}

export const LongPathTooltip: Story = {
  args: {
    diff: {
      loading: false,
      files: [
        {
          file: longPath,
          additions: 1,
          deletions: 1,
          status: "modified",
          defaultExpanded: true,
          patch: `diff --git a/${longPath} b/${longPath}
--- a/${longPath}
+++ b/${longPath}
@@ -1,2 +1,2 @@
-const previous = 1;
+const previous = 2;
`,
        },
        {
          file: rtlLeadingPath,
          additions: 1,
          deletions: 0,
          status: "added",
          defaultExpanded: false,
          patch: "@@ -0,0 +1 @@\n+rtl value\n",
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    const paths = () => [...canvasElement.querySelectorAll<HTMLElement>(".diff-file-path")];
    // CodeView renders its items on the next frame.
    await waitFor(() => expect(paths()).toHaveLength(2));
    await expect(paths().map((path) => path.textContent)).toEqual([longPath, rtlLeadingPath]);

    await step("clips the beginning while keeping the file name", async () => {
      const ltr = measurePathEdges(paths()[0]!);
      await expect(ltr.truncated).toBe(true);
      await expect(ltr.first).toBe(false);
      await expect(ltr.last).toBe(true);

      // Without the explicit LTR base direction the RTL-leading directory
      // takes over the paragraph direction and the file name is clipped.
      const rtl = measurePathEdges(paths()[1]!);
      await expect(rtl.truncated).toBe(true);
      await expect(rtl.last).toBe(true);
    });

    await step("reveals the complete path on hover for an expanded file", async () => {
      await userEvent.hover(paths()[0]!);
      await waitFor(
        async () => {
          const tooltip = document.querySelector('[data-component="tooltip-v2"]');
          await expect(tooltip?.textContent).toBe(longPath);
        },
        { timeout: 2000 },
      );
    });

    await step("keeps the disclosure operable under the tooltip trigger", async () => {
      const disclosure = paths()[0]?.closest(".diff-file-toggle");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(paths()[0]!);
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    });
  },
};
