/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
/* oxlint-disable effecttsgo/global-timers -- Storybook interaction tests poll rendered state. */
/* oxlint-disable effecttsgo/new-promise -- Storybook interaction tests wait on frames and timers. */
import { createMemo, createSignal } from "solid-js";
import type { Decorator, Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { SelectedLineRange } from "@pierre/diffs";
import { preloadHighlighter } from "@pierre/diffs";
import { activeDiffTheme } from "../src/renderer/diff-highlighter.ts";

import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import type {
  DiffFileData,
  DiffReviewView,
  DiffViewPresentation,
} from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import type { ReviewComment } from "../src/renderer/domain/review-drafts.ts";

/** Split a diff fixture into the panel's independent file and presentation props. */
function panelProps(input: DiffViewPresentation & { readonly files: readonly DiffFileData[] }) {
  const { files, ...presentation } = input;
  return { files, presentation };
}

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

/** More files than the panel can show at once, to exercise the render window. */
const manyFiles: readonly DiffFileData[] = Array.from({ length: 24 }, (_, index) => {
  const name = `src/generated/file-${String(index).padStart(2, "0")}.ts`;
  return {
    file: name,
    additions: 1,
    deletions: 1,
    status: "modified",
    patch: `@@ -1 +1 @@\n-old line ${index}\n+new line ${index}\n`,
  };
});

const gutterFiles: readonly DiffFileData[] = [
  {
    file: "src/generated/added.ts",
    additions: 8,
    deletions: 0,
    status: "added",
    patch: `@@ -0,0 +1,8 @@\n${Array.from({ length: 8 }, (_, index) => `+line ${index + 1}\n`).join("")}`,
  },
  {
    file: "src/generated/reversed.ts",
    additions: 8,
    deletions: 0,
    status: "added",
    patch: `@@ -0,0 +1,8 @@\n${Array.from({ length: 8 }, (_, index) => `+other line ${index + 1}\n`).join("")}`,
  },
  {
    file: "src/generated/mixed.ts",
    additions: 2,
    deletions: 2,
    status: "modified",
    patch: "@@ -1,4 +1,4 @@\n first\n-second\n-third\n+second changed\n+third changed\n fourth\n",
  },
];

/** Center point of an element, in the frame's client coordinates. */
const center = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

/** Pointer events with explicit coordinates for Pierre's gutter drag. */
const pointer = (target: Element, type: string, coords: { x: number; y: number }) => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: coords.x,
      clientY: coords.y,
    }),
  );
};

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

const prepareLayoutDiffs = () =>
  preloadHighlighter({
    themes: [activeDiffTheme("light"), activeDiffTheme("dark")],
    langs: ["tsx", "css", "typescript"],
  });

const diffItem = (canvasElement: HTMLElement, path: string) =>
  [...canvasElement.querySelectorAll<HTMLElement>("diffs-container")].find((item) =>
    [...item.querySelectorAll(".diff-file-path")].some((node) => node.textContent === path),
  );

const waitForDiffBody = (canvasElement: HTMLElement, path: string) =>
  waitFor(
    async () => {
      const item = diffItem(canvasElement, path);
      await expect(item?.querySelector("[data-diff-file-toggle]")).toBeTruthy();
      await expect(item?.shadowRoot?.querySelector("[data-code]")?.textContent).toBeTruthy();
      await expect(item?.getBoundingClientRect().height).toBeGreaterThan(30);
    },
    { timeout: 5_000 },
  );

export const Diff: Story = {
  args: {
    ...panelProps({ files: diffFiles, loading: false }),
  },
  // Check renderer readiness without explicitly preloading the shared highlighter.
  play: async ({ canvasElement }) => {
    for (const file of diffFiles) await waitForDiffBody(canvasElement, file.file);
  },
};

export const Loading: Story = {
  args: {
    ...panelProps({
      files: [],
      loading: true,
      comparison: "working",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes vs main" },
      ],
    }),
  },
};

export const NoSession: Story = {
  args: {
    ...panelProps({
      files: [],
      loading: false,
      emptyMessage: "Select a session to view changes",
      emptyDescription: "The Diff panel follows the selected session's workspace location.",
    }),
  },
};

export const Empty: Story = {
  args: {
    ...panelProps({ files: [], loading: false }),
  },
};

export const Unavailable: Story = {
  args: {
    ...panelProps({
      files: [],
      loading: false,
      emptyMessage: "Diff unavailable",
      emptyDescription: "OpenCode diff data is not connected yet.",
    }),
  },
};

export const Error: Story = {
  args: {
    ...panelProps({ files: [], loading: false, error: "The working tree could not be read." }),
  },
};

export const Refreshing: Story = {
  args: {
    ...panelProps({ files: diffFiles, loading: true, stale: true }),
  },
};

export const RefreshError: Story = {
  args: {
    ...panelProps({
      files: diffFiles,
      loading: false,
      stale: true,
      error: "The latest changes could not be loaded.",
      onRetry: () => undefined,
    }),
  },
};

const longDiffError =
  "The working tree could not be read. " +
  "The connected server could not load this comparison; check the workspace location and retry. ".repeat(
    4,
  ) +
  `/workspace/${"unbroken_directory_name".repeat(12)}/changes.ts. End of diff diagnostic.`;
const initialErrorRetry = fn<NonNullable<DiffViewPresentation["onRetry"]>>();
const refreshErrorRetry = fn<NonNullable<DiffViewPresentation["onRetry"]>>();
const errorComparisonChange = fn<NonNullable<DiffViewPresentation["onComparisonChange"]>>();

/** The fixture owns only the controlled comparison; files and status stay supplied by the story. */
const shortErrorRender: Story["render"] = (args) => {
  const [comparison, setComparison] = createSignal("working");
  return (
    <div data-short-diff-slot style={{ width: "168px", height: "160px", overflow: "hidden" }}>
      <ContextPanel
        {...args}
        presentation={{
          ...args.presentation,
          loading: false,
          comparison: comparison(),
          comparisonOptions: [
            { value: "working", label: "Working changes" },
            { value: "branch", label: "Changes vs main" },
          ],
          onComparisonChange: (value) => {
            errorComparisonChange(value);
            setComparison(value);
          },
        }}
      />
    </div>
  );
};

const shortErrorPlay: Story["play"] = async ({ canvasElement, args, step }) => {
  const canvas = within(canvasElement);
  const slot = canvasElement.querySelector<HTMLElement>("[data-short-diff-slot]")!;
  const cached = args.files.length > 0;
  const onRetry = cached ? refreshErrorRetry : initialErrorRetry;
  onRetry.mockClear();
  errorComparisonChange.mockClear();

  for (const [index, width] of [168, 360].entries()) {
    await step(`${width}px wide, 160px high: diagnostic and Retry remain reachable`, async () => {
      slot.style.width = `${width}px`;
      const error = canvas.getByRole("alert");
      const message = canvas.getByText(longDiffError);
      const lines = error.ownerDocument.createRange();
      lines.selectNodeContents(message);
      await expect(slot.getBoundingClientRect().height).toBe(160);
      await expect(slot.getBoundingClientRect().width).toBe(width);
      await expect(error.clientHeight).toBeGreaterThan(0);
      await expect(error.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        slot.getBoundingClientRect().bottom + 1,
      );
      await expect(error.scrollWidth).toBeLessThanOrEqual(error.clientWidth + 1);
      await expect(error.scrollHeight).toBeGreaterThan(error.clientHeight);

      error.scrollTop = 0;
      await expect(lines.getClientRects()[0]!.top).toBeGreaterThanOrEqual(
        error.getBoundingClientRect().top,
      );
      await expect(lines.getClientRects()[0]!.bottom).toBeLessThanOrEqual(
        error.getBoundingClientRect().bottom + 1,
      );
      error.scrollTop =
        [...lines.getClientRects()].at(-1)!.bottom - error.getBoundingClientRect().bottom;
      await expect(error.scrollTop).toBeGreaterThan(0);
      const lastLine = [...lines.getClientRects()].at(-1)!;
      await expect(lastLine.top).toBeGreaterThanOrEqual(error.getBoundingClientRect().top);
      await expect(lastLine.bottom).toBeLessThanOrEqual(error.getBoundingClientRect().bottom + 1);

      const retry = canvas.getByRole("button", { name: "Retry" });
      error.scrollTop = cached ? 0 : error.scrollHeight;
      await expect(retry.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        error.getBoundingClientRect().top,
      );
      await expect(retry.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        error.getBoundingClientRect().bottom + 1,
      );
      const point = center(retry);
      await expect(retry.contains(error.ownerDocument.elementFromPoint(point.x, point.y))).toBe(
        true,
      );
      await userEvent.click(retry);
      await expect(onRetry).toHaveBeenCalledTimes(index + 1);

      const selector = canvas.getByRole("button", { name: /Diff comparison/ });
      await userEvent.click(selector);
      const label = index === 0 ? "Changes vs main" : "Working changes";
      await userEvent.click(
        await within(canvasElement.ownerDocument.body).findByRole("option", { name: label }),
      );
      await expect(errorComparisonChange).toHaveBeenLastCalledWith(
        index === 0 ? "branch" : "working",
      );
      await expect(selector).toHaveTextContent(label);
      await expect(error).toHaveTextContent(longDiffError);
      await expect(canvas.queryByText("Refreshing diff")).not.toBeInTheDocument();
      await expect(canvas.queryByText("Showing cached changes")).not.toBeInTheDocument();

      const viewport = canvasElement.querySelector<HTMLElement>(".diff-code-view");
      if (cached) {
        await canvas.findByRole("button", { name: `Collapse ${diffFiles[0]!.file}` });
        await expect(viewport!.clientHeight).toBeGreaterThan(0);
        await expect(viewport!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          slot.getBoundingClientRect().bottom + 1,
        );
        await expect(viewport!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          error.getBoundingClientRect().bottom,
        );
        await expect(viewport!.scrollHeight).toBeGreaterThan(viewport!.clientHeight);
        const diagnosticScroll = error.scrollTop;
        viewport!.scrollTop = viewport!.scrollHeight;
        await expect(viewport!.scrollTop).toBeGreaterThan(0);
        await expect(error.scrollTop).toBe(diagnosticScroll);
        viewport!.scrollTop = 0;
      } else {
        await expect(viewport).toBeNull();
        await expect(canvas.queryByText("No working tree changes")).not.toBeInTheDocument();
      }
    });
  }
};

export const ShortInitialError: Story = {
  args: {
    ...panelProps({ files: [], loading: false, error: longDiffError, onRetry: initialErrorRetry }),
  },
  render: shortErrorRender,
  play: shortErrorPlay,
};

export const ShortRefreshError: Story = {
  args: {
    ...panelProps({
      files: diffFiles,
      loading: false,
      stale: true,
      error: longDiffError,
      onRetry: refreshErrorRetry,
    }),
  },
  render: shortErrorRender,
  play: shortErrorPlay,
};

export const CachedStale: Story = {
  args: {
    ...panelProps({ files: diffFiles, loading: false, stale: true }),
  },
};

export const BranchEmpty: Story = {
  args: {
    ...panelProps({
      files: [],
      loading: false,
      comparison: "branch",
      comparisonOptions: [
        { value: "working", label: "Working changes" },
        { value: "branch", label: "Changes vs main" },
      ],
      emptyMessage: "No changes against main",
      emptyDescription: "The working copy matches its merge base with main.",
    }),
  },
};

export const DiffEdgeCases: Story = {
  args: {
    ...panelProps({
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
    }),
  },
};

export const CollapseAll: Story = {
  beforeEach: prepareLayoutDiffs,
  args: {
    ...panelProps({ files: diffFiles, loading: false }),
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".diff-code-view")!;
    const expectContentStart = async () => {
      await expect(viewport.clientHeight).toBeGreaterThan(0);
      await expect(viewport.scrollTop).toBe(0);
      const first = diffItem(canvasElement, diffFiles[0]!.file)!.getBoundingClientRect();
      const start = viewport.getBoundingClientRect().top + viewport.clientTop;
      await expect(Math.abs(first.top - start)).toBeLessThanOrEqual(1);
    };

    await step("collapse every file", async () => {
      for (const file of diffFiles) {
        await canvas.findByRole("button", { name: `Collapse ${file.file}` });
        await waitForDiffBody(canvasElement, file.file);
      }
      await waitFor(expectContentStart);
      await userEvent.click(canvas.getByRole("button", { name: "Collapse all files" }));
      await expect(canvas.getByRole("button", { name: "Expand all files" })).toBeVisible();
      for (const file of diffFiles) {
        const toggle = await canvas.findByRole(
          "button",
          { name: `Expand ${file.file}` },
          { timeout: 5_000 },
        );
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
      }
      // Collapsed rows must render at their measured height or the list
      // bottom-aligns in the leftover space and pushes the first row down.
      await waitFor(
        async () => {
          await expectContentStart();
          const bounds = diffFiles.map((file) =>
            diffItem(canvasElement, file.file)!.getBoundingClientRect(),
          );
          for (const [index, rect] of bounds.entries()) {
            // Literal product contract: 30px header plus the 8px card gap.
            await expect(rect.height).toBe(38);
            if (index > 0) await expect(rect.top).toBe(bounds[index - 1]!.bottom);
          }
        },
        { timeout: 5_000 },
      );
    });

    await step("expand every file", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Expand all files" }));
      await expect(canvas.getByRole("button", { name: "Collapse all files" })).toBeVisible();
      for (const file of diffFiles) {
        const toggle = await canvas.findByRole(
          "button",
          { name: `Collapse ${file.file}` },
          { timeout: 5_000 },
        );
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await waitForDiffBody(canvasElement, file.file);
      }
    });
  },
};

export const VirtualizedList: Story = {
  beforeEach: prepareLayoutDiffs,
  args: {
    ...panelProps({ files: manyFiles, loading: false }),
  },
  play: async ({ canvasElement, step }) => {
    const viewport = () => canvasElement.querySelector<HTMLElement>(".diff-code-view");
    const rendered = () => canvasElement.querySelectorAll("diffs-container").length;
    const path = (index: number) =>
      [...canvasElement.querySelectorAll<HTMLElement>(".diff-file-path")].find(
        (node) => node.textContent === `src/generated/file-${String(index).padStart(2, "0")}.ts`,
      );

    await step("renders only the visible window", async () => {
      await waitForDiffBody(canvasElement, manyFiles[0]!.file);
      await expect(viewport()!.clientHeight).toBeGreaterThan(0);
      await waitFor(() => expect(path(0)).not.toBeUndefined(), { timeout: 5_000 });
      await waitFor(() => expect(rendered()).toBeLessThan(manyFiles.length), { timeout: 5_000 });
      await expect(path(0)).not.toBeUndefined();
      await expect(path(manyFiles.length - 1)).toBeUndefined();
    });

    await step("renders later items after scrolling", async () => {
      const scroller = viewport();
      await expect(scroller).not.toBeNull();
      scroller!.scrollTop = scroller!.scrollHeight;
      await waitFor(() => expect(path(manyFiles.length - 1)).not.toBeUndefined(), {
        timeout: 5_000,
      });
      await waitForDiffBody(canvasElement, manyFiles.at(-1)!.file);
      await expect(path(0)).toBeUndefined();
      await expect(rendered()).toBeLessThan(manyFiles.length);
    });

    await step("reuses the window after scrolling back", async () => {
      const scroller = viewport();
      await expect(scroller).not.toBeNull();
      scroller!.scrollTop = 0;
      await waitFor(() => expect(path(0)).not.toBeUndefined(), { timeout: 5_000 });
      await waitForDiffBody(canvasElement, manyFiles[0]!.file);
      await expect(rendered()).toBeLessThan(manyFiles.length);
    });
  },
};

const onGutterSelection = fn<NonNullable<DiffReviewView["onBeginComment"]>>();
export const GutterRangeSelection: Story = {
  args: {
    ...panelProps({ files: gutterFiles, loading: false }),
    review: { comments: [], onBeginComment: onGutterSelection },
  },
  play: async ({ canvasElement, step }) => {
    onGutterSelection.mockClear();
    type LineType = "change-addition" | "change-deletion";
    const item = (name: string) =>
      [...canvasElement.querySelectorAll("diffs-container")].find((container) =>
        [...container.querySelectorAll(".diff-file-path")].some(
          (node) => node.textContent === name,
        ),
      );
    const line = (name: string, lineNumber: number, type: LineType) =>
      item(name)?.shadowRoot?.querySelector<HTMLElement>(
        `[data-column-number="${lineNumber}"][data-line-type="${type}"]`,
      );
    const utility = (name: string) =>
      item(name)?.shadowRoot?.querySelector<HTMLElement>("[data-utility-button]");
    const captured = () => {
      const range = onGutterSelection.mock.calls.at(-1)?.[1];
      return range && `${range.start}:${range.side}-${range.end}:${range.endSide ?? range.side}`;
    };

    /**
     * Worker highlighting replaces the item's shadow contents after the first
     * frame. Wait until the DOM has stopped changing before querying it.
     */
    const settle = async (name: string) => {
      let previous = -1;
      await waitFor(
        async () => {
          const current = item(name)?.shadowRoot?.innerHTML.length ?? 0;
          const stable = current > 0 && current === previous;
          previous = current;
          await new Promise((resolve) => setTimeout(resolve, 200));
          await expect(stable).toBe(true);
        },
        { timeout: 10_000 },
      );
    };

    const drag = async (
      name: string,
      from: { line: number; type: LineType },
      to: { line: number; type: LineType },
    ) => {
      await settle(name);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const start = line(name, from.line, from.type);
        const end = line(name, to.line, to.type);
        if (!start || !end) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        const before = captured();
        pointer(start, "pointermove", center(start));
        // The utility is repositioned on a later frame, so let it move before
        // reading its coordinates.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const button = utility(name);
        if (!button) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        pointer(button, "pointerdown", center(button));
        pointer(end, "pointermove", center(end));
        pointer(end, "pointerup", center(end));
        const matched = await waitFor(() => expect(captured()).not.toBe(before), {
          timeout: 5_000,
        }).then(
          () => true,
          () => false,
        );
        if (matched) return;
      }
      throw new TypeError(`Gutter drag for ${name} did not produce a selection`);
    };

    await step("captures a forward range", async () => {
      await drag(
        "src/generated/added.ts",
        { line: 1, type: "change-addition" },
        { line: 6, type: "change-addition" },
      );
      await expect(captured()).toBe("1:additions-6:additions");
    });

    await step("captures a reverse range", async () => {
      await drag(
        "src/generated/reversed.ts",
        { line: 6, type: "change-addition" },
        { line: 1, type: "change-addition" },
      );
      await expect(captured()).toBe("6:additions-1:additions");
    });

    await step("captures a cross-side range", async () => {
      await drag(
        "src/generated/mixed.ts",
        { line: 2, type: "change-deletion" },
        { line: 3, type: "change-addition" },
      );
      await expect(captured()).toBe("2:deletions-3:additions");
    });
  },
};

export const ComparisonControl: Story = {
  args: {
    ...panelProps({ files: diffFiles, loading: false }),
  },
  render: () => {
    const [comparison, setComparison] = createSignal("working");
    // Keep `files` a stable prop source; only presentation reacts to the signal.
    return (
      <ContextPanel
        files={diffFiles}
        presentation={{
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
    ...panelProps({ files: diffFiles, loading: false }),
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
    const view = createMemo<DiffReviewView>(() => ({
      comments: [comment()],
      editingCommentID: editingCommentID(),
      selectedLines: { path: comment().path, range: selection },
      onUpdateCommentBody: (_id: string, nextBody: string) => setBody(nextBody),
      onEditComment: (commentID: string) => setEditingCommentID(commentID),
      onFinishComment: () => setEditingCommentID(undefined),
      onRemoveComment: () => setEditingCommentID(undefined),
    }));
    return <ContextPanel {...panelProps({ files: diffFiles, loading: false })} review={view()} />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const editorName = `Comment on ${diffFiles[0]!.file}`;

    await step("editing preserves comment height and grows with multiline text", async () => {
      const editor = await canvas.findByRole("textbox", { name: editorName });
      const initialHeight = editor.parentElement!.getBoundingClientRect().height;
      await userEvent.click(editor);
      await userEvent.keyboard("{Escape}");
      const text = await canvas.findByRole("button", {
        name: "Please keep this state controlled by the parent.",
      });
      await expect(
        Math.abs(text.parentElement!.getBoundingClientRect().height - initialHeight),
      ).toBeLessThanOrEqual(1);

      await userEvent.click(text);
      const reopened = await canvas.findByRole("textbox", { name: editorName });
      await expect(reopened).toHaveFocus();
      await userEvent.keyboard("{End}{Shift>}{Enter}{/Shift}Keep the existing behavior.");
      await expect(reopened).toHaveValue(
        "Please keep this state controlled by the parent.\nKeep the existing behavior.",
      );
      await expect(reopened.parentElement!.getBoundingClientRect().height).toBeGreaterThan(
        initialHeight,
      );
      await expect(reopened.scrollHeight).toBeLessThanOrEqual(reopened.clientHeight + 1);
      await userEvent.keyboard("{Escape}");
      await expect(
        await canvas.findByRole("button", {
          name: /Please keep this state controlled by the parent\.\s+Keep the existing behavior\./,
        }),
      ).toBeVisible();
    });
  },
};

export const NoClose: Story = {
  args: {
    onClose: undefined,
    ...panelProps({ files: diffFiles, loading: false }),
  },
};

export const CloseFocused: Story = {
  args: {
    autoFocusClose: true,
    ...panelProps({ files: diffFiles, loading: false }),
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
    ...panelProps({
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
    }),
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
    ...panelProps({
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
    }),
  },
  play: async ({ canvasElement, step }) => {
    const paths = () => [...canvasElement.querySelectorAll<HTMLElement>(".diff-file-path")];
    // CodeView renders its items on the next frame.
    await waitFor(() => expect(paths()).toHaveLength(2), { timeout: 5_000 });
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
        { timeout: 5_000 },
      );
    });

    await step("keeps the disclosure operable under the tooltip trigger", async () => {
      const disclosure = paths()[0]?.closest(".diff-file-toggle");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      // Exercise a click that can settle before Pierre's next render frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await userEvent.click(paths()[0]!);
      // CodeView updates the header in its queued animation-frame render.
      await waitFor(() => expect(disclosure).toHaveAttribute("aria-expanded", "false"), {
        timeout: 5_000,
      });
    });
  },
};
