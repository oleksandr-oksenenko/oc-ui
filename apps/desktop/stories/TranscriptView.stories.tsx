/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  TranscriptView,
  type TranscriptViewProps,
} from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import {
  assistant,
  streamingAssistant,
  markdownAssistant,
  fileImageAssistant,
  richItems,
  reviewPrompt,
  allTranscriptElements,
  longTranscript,
  longAnchorTranscript,
  toolStates,
  shellStates,
  compactionStates,
} from "./transcript-catalog-fixtures.ts";
import { previewImageBase64, previewImageMime } from "./image-fixtures.ts";
import { TranscriptPendingFixture } from "./transcript-catalog/TranscriptPendingFixture.tsx";
import { TranscriptUpdatesFixture } from "./transcript-catalog/TranscriptUpdatesFixture.tsx";

const meta = {
  title: "Transcript/TranscriptView",
  component: TranscriptView,
  args: { sessionID: "transcript-story" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TranscriptView>;
export default meta;
type Story = StoryObj<typeof meta>;

const renderTranscript = (args: TranscriptViewProps) => (
  <div style={{ height: "100vh", "min-height": "520px", background: "var(--oc-surface-canvas)" }}>
    <TranscriptView {...args} />
  </div>
);

// Constrains the transcript viewport so scroll behavior can be inspected.
const renderConstrainedTranscript = (args: TranscriptViewProps) => (
  <div style={{ height: "100vh", display: "grid", "grid-template-rows": "minmax(0, 1fr)" }}>
    <TranscriptView {...args} />
  </div>
);

// A narrow column stresses metadata and image rows at their tightest.
const renderNarrowTranscript = (args: TranscriptViewProps) => (
  <div style={{ width: "260px", height: "100vh", background: "var(--oc-surface-canvas)" }}>
    <TranscriptView {...args} />
  </div>
);

// Stands in for the workspace reader so the story can verify server-backed
// file images without a live OpenCode runtime.
const readStoryFileImage = async (): Promise<Blob> =>
  new Blob([Uint8Array.from(atob(previewImageBase64), (character) => character.charCodeAt(0))], {
    type: previewImageMime,
  });

export const Rich: Story = {
  args: { messages: richItems, sessionStatus: "idle", loading: false },
  render: renderTranscript,
};

export const ImagePreviews: Story = {
  args: { messages: richItems, sessionStatus: "idle", loading: false },
  render: renderTranscript,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Enlarge a user image attachment", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Enlarge preview.png" }));
      const dialog = await screen.findByRole("dialog", { name: "Preview of preview.png" });
      await expect(dialog).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Preview of preview.png" })).toBeNull(),
      );
    });
  },
};

const settle = () =>
  // oxlint-disable-next-line effecttsgo/new-promise -- Browser layout frames are owned and awaited by the story.
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export const ScrollPreservation: Story = {
  args: { messages: [], sessionStatus: "running" },
  render: () => <TranscriptUpdatesFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    // Wait for progressive materialization to finish before capturing rows so
    // the append/scroll assertions run against the full, stable list.
    await waitFor(() =>
      expect(canvasElement.querySelectorAll(".transcript-message")).toHaveLength(40),
    );
    const tool = canvas.getByRole("button", { name: "read README.md Running" });
    const rows = [...canvasElement.querySelectorAll(".transcript-message")];
    const distanceFromBottom = () =>
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    await waitFor(() => expect(distanceFromBottom()).toBeLessThan(2));
    tool.click();
    await settle();
    viewport.scrollTop +=
      tool.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 60;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    const readingPosition = tool.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    await expect(viewport.scrollTop).toBeGreaterThan(0);
    await expect(distanceFromBottom()).toBeGreaterThan(viewport.clientHeight);

    // DOM clicks avoid moving focus/scroll to the fixture controls during a server-like update.
    canvas.getByRole("button", { name: "Advance response" }).click();
    await settle();
    canvas.getByRole("button", { name: "Finish turn" }).click();
    await settle();
    await expect(canvas.getByRole("button", { name: "read README.md Completed" })).toBe(tool);
    await expect(tool).toHaveAttribute("aria-expanded", "true");
    await expect(
      Math.abs(
        tool.getBoundingClientRect().top - viewport.getBoundingClientRect().top - readingPosition,
      ),
    ).toBeLessThan(2);
    const updatedRows = [...canvasElement.querySelectorAll(".transcript-message")];
    for (const [index, row] of rows.entries()) {
      await expect(updatedRows[index]).toBe(row);
    }

    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    canvas.getByRole("button", { name: "Advance response" }).click();
    await settle();
    canvas.getByRole("button", { name: "Finish turn" }).click();
    await settle();
    await waitFor(() => expect(distanceFromBottom()).toBeLessThan(2));
    await expect(tool).toHaveAttribute("aria-expanded", "true");
  },
};
export const Markdown: Story = {
  args: { messages: [markdownAssistant], sessionStatus: "idle", loading: false },
  render: renderTranscript,
};
export const MarkdownFileImage: Story = {
  args: {
    messages: [fileImageAssistant],
    sessionStatus: "idle",
    loading: false,
    readFileImage: readStoryFileImage,
  },
  render: renderTranscript,
  play: async ({ canvasElement, step }) => {
    await step("resolves and renders a server file image from Markdown", async () => {
      const image = await waitFor(() => {
        const element = canvasElement.querySelector<HTMLImageElement>("img[data-file-src]");
        if (!element || !element.src.startsWith("blob:")) {
          throw new Error("The file image was not resolved to a blob URL");
        }
        return element;
      });
      await waitFor(() => expect(image.complete).toBe(true));
      await expect(image.naturalWidth).toBeGreaterThan(0);
      await expect(image.alt).toBe("Tool states");
    });
  },
};
export const SentCodeReview: Story = {
  args: {
    messages: [],
    sessionStatus: "idle",
    loading: false,
  },
  render: () =>
    renderTranscript({
      sessionID: "sent-code-review",
      messages: [
        {
          id: "sent-code-review",
          time: { created: 1 },
          type: "user",
          text: reviewPrompt.text,
          metadata: reviewPrompt.metadata,
        },
      ],
      sessionStatus: "idle",
      loading: false,
    }),
};
export const Loading: Story = {
  args: { messages: [], sessionStatus: "idle", loading: true },
  render: renderTranscript,
};
export const Empty: Story = {
  args: { messages: [], sessionStatus: "idle", loading: false },
  render: renderTranscript,
};
export const Failure: Story = {
  args: {
    messages: [],
    sessionStatus: "idle",
    loading: false,
    error: "This transcript could not be loaded.",
    onRetry: () => undefined,
  },
  render: renderTranscript,
};
export const Streaming: Story = {
  args: {
    messages: [...richItems, streamingAssistant],
    sessionStatus: "running",
    loading: false,
    workingLabel: "Generating the transcript…",
  },
  render: renderTranscript,
};
export const FailedStates: Story = {
  args: {
    messages: [assistant("assistant-failed", "error")],
    sessionStatus: "idle",
    loading: false,
  },
  render: renderTranscript,
};
export const DescriptiveWorking: Story = {
  args: {
    messages: [],
    sessionStatus: "running",
    loading: false,
    workingLabel: "Generating visual regression report…",
  },
  render: renderTranscript,
};

export const AllElements: Story = {
  args: { messages: allTranscriptElements, sessionStatus: "running", loading: false },
  render: (args) => renderTranscript({ ...args, pendingInteraction: <TranscriptPendingFixture /> }),
};
export const ToolStates: Story = {
  args: { messages: toolStates, sessionStatus: "running" },
  render: renderTranscript,
};
export const ToolImageLongMetadata: Story = {
  args: { messages: toolStates, sessionStatus: "idle", loading: false },
  render: renderNarrowTranscript,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Clips long tool parameters to one line", async () => {
      const parameters = [
        ...canvasElement.querySelectorAll<HTMLElement>(".transcript-tool-parameter"),
      ];
      await expect(parameters.length).toBeGreaterThan(0);
      for (const parameter of parameters) {
        // A single line keeps the box at its line height; a wrapped value would
        // grow it while still satisfying a scroll-height check.
        const lineHeight = Number.parseFloat(getComputedStyle(parameter).lineHeight);
        await expect(parameter.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight + 1);
        const header = parameter.closest<HTMLElement>(".transcript-tool-header");
        if (!header) throw new Error("Tool header is missing");
        await expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
      }
      // The long path fixture is wider than its box, so the ellipsis clips it
      // instead of wrapping or widening the row.
      const long = parameters.find((parameter) => parameter.textContent?.endsWith("…"));
      if (!long) throw new Error("Long parameter fixture is missing");
      await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth + 1);
    });
    await step("Keeps the image preview readable under long metadata", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "browser_capture Completed" }));
      const thumbnail = await waitFor(() => {
        const element = canvasElement.querySelector<HTMLElement>(
          ".transcript-tool-image-thumbnail",
        );
        if (!element) throw new Error("Tool image thumbnail did not render");
        return element;
      });
      const file = thumbnail.closest<HTMLElement>(".transcript-tool-file");
      if (!file) throw new Error("Tool image container is missing");
      const name = file.querySelector<HTMLElement>(".transcript-tool-file-name");
      if (!name) throw new Error("Tool image name is missing");
      await waitFor(() => expect(thumbnail.querySelector("img")?.complete).toBe(true));

      const fileRect = file.getBoundingClientRect();
      const nameRect = name.getBoundingClientRect();
      const thumbnailRect = thumbnail.getBoundingClientRect();
      // The image keeps a usable width instead of collapsing beside the metadata.
      await expect(thumbnailRect.width).toBeGreaterThan(150);
      await expect(thumbnailRect.width).toBeGreaterThan(fileRect.width * 0.7);
      // The image owns a row below the metadata rather than sharing its line.
      await expect(nameRect.bottom).toBeLessThanOrEqual(thumbnailRect.top + 1);
      // Long metadata truncates instead of overflowing the transcript column.
      await expect(file.scrollWidth).toBeLessThanOrEqual(file.clientWidth + 1);
      await expect(thumbnail.querySelector("img")?.naturalWidth ?? 0).toBeGreaterThan(0);
    });
  },
};
export const ShellStates: Story = {
  args: { messages: shellStates, sessionStatus: "idle" },
  render: renderTranscript,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Keyboard-focusable annotated output keeps its focus indicator", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /pnpm check/ }));
      const output = await waitFor(() => {
        const element = canvasElement.querySelector<HTMLElement>(
          "pre.transcript-tool-output[data-annotation-block]",
        );
        if (!element) throw new Error("Shell output did not render");
        return element;
      });
      await expect(output.scrollHeight).toBeGreaterThan(output.clientHeight);
      await userEvent.tab();
      output.focus();
      await waitFor(() => expect(output).toHaveFocus());
      await expect(output.matches(":focus-visible")).toBe(true);
      await expect(getComputedStyle(output).outlineStyle).not.toBe("none");
    });
  },
};
export const CompactionStates: Story = {
  args: { messages: compactionStates, sessionStatus: "idle" },
  render: renderTranscript,
};
export const PendingRequests: Story = {
  args: { messages: [], sessionStatus: "idle" },
  render: (args) => renderTranscript({ ...args, pendingInteraction: <TranscriptPendingFixture /> }),
};
export const PendingRequestsSubmitting: Story = {
  ...PendingRequests,
  render: (args) =>
    renderTranscript({ ...args, pendingInteraction: <TranscriptPendingFixture submitting /> }),
};
export const PendingRequestsFailure: Story = {
  ...PendingRequests,
  render: (args) =>
    renderTranscript({
      ...args,
      pendingInteraction: (
        <TranscriptPendingFixture error="The reply could not be sent. Try again." />
      ),
    }),
};
export const Refreshing: Story = {
  args: { messages: richItems, sessionStatus: "idle", loading: true },
  render: renderTranscript,
};
export const RefreshFailure: Story = {
  args: {
    messages: richItems,
    sessionStatus: "idle",
    error: "Could not refresh the transcript.",
    onRetry: () => undefined,
  },
  render: renderTranscript,
};

export const CatalogInteractions: Story = {
  ...AllElements,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of [
      "read Streaming",
      "grep TranscriptView Running",
      "apply_patch Completed",
      "bash pnpm build Error",
      "skill release-checklist Completed",
      "pnpm watch Killed",
      "Compaction manual Failed",
      "Code review · 2 comments",
      "Annotations · 1 comment",
    ]) {
      await userEvent.click(canvas.getByRole("button", { name }));
    }
    await expect(canvas.getByText("Output truncated", { exact: true })).toBeInTheDocument();
    await expect(
      canvas.getByText("The provider is unavailable. Try again.", { exact: true }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("Which changes did you check?", { exact: true }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Allow once" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(
      canvas.queryByRole("form", { name: "Where should I make this change?" }),
    ).not.toBeInTheDocument();
  },
};

export const LongTranscriptMaterialization: Story = {
  args: { messages: longTranscript, sessionStatus: "idle", loading: false },
  render: renderConstrainedTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    await waitFor(() =>
      expect(canvasElement.querySelectorAll("[data-message-id]")).toHaveLength(
        longTranscript.length,
      ),
    );
    await waitFor(() => expect(view).toHaveAttribute("aria-busy", "false"));
    // With no reader interaction the viewport followed the newest rows.
    if (!view) throw new Error("Transcript viewport is missing");
    await expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeLessThan(2);
    const oldest = canvasElement.querySelector<HTMLElement>('[data-message-id="long-oldest"]');
    if (!oldest) throw new Error("The oldest materialized row is missing");
    const trigger = within(oldest).getByRole("button", {
      name: /release-check Completed/,
    });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/migrations: ready/)).toBeInTheDocument();
  },
};

export const LongTranscriptReadingAnchor: Story = {
  args: { messages: longAnchorTranscript, sessionStatus: "idle", loading: false },
  render: renderConstrainedTranscript,
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    if (!view) throw new Error("Transcript viewport is missing");
    const rows = () => canvasElement.querySelectorAll<HTMLElement>("[data-message-id]");
    // Catch the pass in flight: recent rows exist, the history is not complete.
    await waitFor(() => {
      const count = rows().length;
      if (
        view.getAttribute("aria-busy") !== "true" ||
        count <= 40 ||
        count >= longAnchorTranscript.length
      ) {
        throw new Error(`not mid-materialization: count=${count}`);
      }
    });

    // Move the reader away from the bottom before older rows prepend.
    view.scrollTop = Math.round((view.scrollHeight - view.clientHeight) / 2);
    view.dispatchEvent(new Event("scroll"));
    const bounds = view.getBoundingClientRect();
    const anchor = [...rows()].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
    if (!anchor) throw new Error("No fully visible row to anchor");
    const anchorTop = anchor.getBoundingClientRect().top;
    const distanceBefore = view.scrollHeight - view.clientHeight - view.scrollTop;
    await expect(view.style.overflowAnchor).toBe("auto");

    await waitFor(() => expect(rows()).toHaveLength(longAnchorTranscript.length));
    await waitFor(() => expect(view).toHaveAttribute("aria-busy", "false"));

    // The reading anchor survived the older batches.
    await expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(8);
    // The viewport was not dragged back to the bottom.
    await expect(
      Math.abs(view.scrollHeight - view.clientHeight - view.scrollTop - distanceBefore),
    ).toBeLessThan(8);
  },
};

export const LongTranscriptSelectionPause: Story = {
  args: { messages: longAnchorTranscript, sessionStatus: "idle", loading: false },
  render: renderConstrainedTranscript,
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    if (!view) throw new Error("Transcript viewport is missing");
    const rows = () => canvasElement.querySelectorAll<HTMLElement>("[data-message-id]");
    await waitFor(() => {
      const count = rows().length;
      if (view.getAttribute("aria-busy") !== "true" || count <= 20) {
        throw new Error(`not mid-materialization: count=${count}`);
      }
    });

    // Select a fully visible row while older rows are still prepending.
    view.scrollTop = Math.round((view.scrollHeight - view.clientHeight) / 2);
    view.dispatchEvent(new Event("scroll"));
    const bounds = view.getBoundingClientRect();
    const anchor = [...rows()].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
    if (!anchor) throw new Error("No fully visible row to anchor");
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = window.getSelection();
    if (!selection) throw new Error("Selection is unavailable");
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    // The pause holds the rendered range: nothing mounts above the selection.
    const anchorTop = anchor.getBoundingClientRect().top;
    const pausedCount = rows().length;
    let frames = 0;
    const countFrames = () => {
      frames += 1;
      if (frames < 3) requestAnimationFrame(countFrames);
    };
    requestAnimationFrame(countFrames);
    await waitFor(() => expect(frames).toBeGreaterThanOrEqual(3));
    await expect(rows()).toHaveLength(pausedCount);
    await expect(view).toHaveAttribute("aria-busy", "false");
    await expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(8);

    // A deliberate downward gesture at the bottom resumes and completes the
    // history while the selection is still present.
    view.scrollTop = view.scrollHeight;
    view.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true }));
    await waitFor(() => expect(rows()).toHaveLength(longAnchorTranscript.length));
    await expect(selection.isCollapsed).toBe(false);
    await expect(anchor.contains(selection.anchorNode)).toBe(true);
  },
};
