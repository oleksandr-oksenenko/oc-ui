/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, onCleanup } from "solid-js";

import {
  TranscriptView,
  type TranscriptViewProps,
} from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import {
  assistant,
  streamingAssistant,
  markdownAssistant,
  tableAssistant,
  fileImageAssistant,
  richItems,
  reviewPrompt,
  allTranscriptElements,
  longTranscript,
  longAnchorTranscript,
  toolStates,
  shellStates,
  compactionStates,
  interleavedActivity,
  midLengthToolPath,
  longToolCommand,
  longToolPath,
  longShellCommand,
  longNamedTools,
  longToolNamePrefix,
  longToolNameSuffixes,
  allParameterTools,
} from "./transcript-catalog-fixtures.ts";
import { previewImageBase64, previewImageMime } from "./image-fixtures.ts";
import { TranscriptPendingFixture } from "./transcript-catalog/TranscriptPendingFixture.tsx";
import { TranscriptUpdatesFixture } from "./transcript-catalog/TranscriptUpdatesFixture.tsx";
import { TranscriptActivityFixture } from "./transcript-catalog/TranscriptActivityFixture.tsx";
import { ActivityStatesFixture } from "./transcript-catalog/ActivityStatesFixture.tsx";
import { browserMessage } from "./attachment-fixtures.ts";
import {
  browserAnnotationMetadata,
  readBrowserAnnotationMetadata,
} from "../src/renderer/opencode/browser-annotation-metadata.ts";

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
  <div
    style={{
      width: "260px",
      height: "100vh",
      display: "grid",
      "grid-template-rows": "minmax(0, 1fr)",
      background: "var(--oc-surface-canvas)",
    }}
  >
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

export const BrowserAttachmentDurableUpdate: Story = {
  args: { messages: [browserMessage], sessionStatus: "idle" },
  render: (args) => {
    const [message, setMessage] = createSignal(browserMessage);
    const [session, setSession] = createSignal(args.sessionID);
    const [present, setPresent] = createSignal(true);
    return (
      <div
        style={{ height: "100vh", display: "grid", "grid-template-rows": "minmax(0, 1fr)" }}
        data-durable-message-fixture
        ref={(element) => {
          const replace = () =>
            setMessage({
              ...browserMessage,
              text: "Acknowledged browser prompt",
              metadata: browserAnnotationMetadata(
                "Acknowledged browser prompt",
                readBrowserAnnotationMetadata(browserMessage.metadata)!.annotations,
              ),
            });
          element.addEventListener("durable-message", replace);
          const changeSession = () => setSession("another-transcript-session");
          const remove = () => setPresent(false);
          element.addEventListener("session-change", changeSession);
          element.addEventListener("remove-message", remove);
          onCleanup(() => {
            element.removeEventListener("durable-message", replace);
            element.removeEventListener("session-change", changeSession);
            element.removeEventListener("remove-message", remove);
          });
        }}
      >
        <TranscriptView
          {...args}
          sessionID={session()}
          sessionStatus="idle"
          messages={present() ? [message()] : []}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Browser · 1" });
    await userEvent.click(trigger);
    await screen.findByRole("button", { name: "Enlarge Browser annotation 1" });
    // An SDK acknowledgement replaces the same-ID object without pointer/focus input.
    canvasElement
      .querySelector("[data-durable-message-fixture]")!
      .dispatchEvent(new Event("durable-message"));
    await canvas.findByText("Acknowledged browser prompt");
    await expect(canvas.getByRole("button", { name: "Browser · 1" })).toBe(trigger);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(
      await screen.findByRole("button", { name: "Enlarge Browser annotation 1" }),
    );
    await screen.findByRole("dialog", { name: "Preview of Browser annotation 1" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enlarge Browser annotation 1" })).toHaveFocus(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await screen.findByRole("button", { name: "Enlarge Browser annotation 1" });
    await userEvent.click(canvas.getByText("Acknowledged browser prompt"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Enlarge Browser annotation 1" })).toBeNull(),
    );
    await userEvent.click(trigger);
    await screen.findByRole("button", { name: "Enlarge Browser annotation 1" });
    const fixture = canvasElement.querySelector("[data-durable-message-fixture]")!;
    fixture.dispatchEvent(new Event("session-change"));
    await waitFor(() => expect(trigger.isConnected).toBe(false));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Enlarge Browser annotation 1" })).toBeNull(),
    );
    const next = canvas.getByRole("button", { name: "Browser · 1" });
    await userEvent.click(next);
    await screen.findByRole("button", { name: "Enlarge Browser annotation 1" });
    fixture.dispatchEvent(new Event("remove-message"));
    await waitFor(() => expect(next.isConnected).toBe(false));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Enlarge Browser annotation 1" })).toBeNull(),
    );
  },
};

/** Muted activity disclosures keep the emphasis on model messages. */
export const MutedActivity: Story = {
  args: {
    sessionStatus: "idle",
    messages: [
      {
        id: "timeline-prompt",
        type: "user",
        time: { created: 1 },
        text: "Review the release checks and summarize the result.",
      },
      assistant("timeline-first"),
      assistant("timeline-second"),
      {
        id: "timeline-answer",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test" },
        time: { created: 4, completed: 5 },
        finish: "stop",
        content: [
          {
            type: "text",
            text: "The release checks passed. The migrations are ready and the background job completed successfully.",
          },
        ],
      },
      { id: "timeline-idle", type: "idle", time: { created: 6 }, outcome: "succeeded" },
    ],
  },
  render: (args) =>
    renderTranscript({
      ...args,
      activityOpen: new Map([[JSON.stringify(["transcript-story", "timeline-first", 1]), true]]),
    }),
  play: async ({ canvasElement }) => {
    const headings = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".transcript-activity-trigger",
    );
    await expect(headings).toHaveLength(2);
    await expect(headings[0]).toHaveAttribute("aria-expanded", "true");
    await expect(headings[1]).toHaveAttribute("aria-expanded", "false");
    const answer = within(canvasElement).getByText(/The release checks passed/);
    headings[1]!.focus();
    await userEvent.keyboard("{Enter}");
    await expect(headings[1]).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    await expect(headings[1]).toHaveAttribute("aria-expanded", "false");
    await expect(answer).toBeVisible();
  },
};

export const CollapsedActivity: Story = {
  args: { messages: [assistant("activity-review")], sessionStatus: "idle" },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const activity = canvasElement.querySelector<HTMLButtonElement>(
      ".transcript-activity-trigger",
    )!;
    await expect(activity).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("button", { name: "Reasoning" })).toBeNull();
    activity.focus();
    await userEvent.keyboard("{Enter}");
    const tool = canvas.getByRole("button", { name: "release-check Completed" });
    await userEvent.click(tool);
    await expect(canvas.getByText(/migrations: ready/)).toBeVisible();
    activity.focus();
    await userEvent.keyboard(" ");
    await expect(activity).toHaveAttribute("aria-expanded", "false");
    await expect(tool).not.toBeVisible();
    await expect(canvas.queryByRole("button", { name: "release-check Completed" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "release-check Completed" })).toBe(tool);
    await expect(tool).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/migrations: ready/)).toBeVisible();
  },
};

export const ContextLongDescription: Story = {
  args: {
    sessionStatus: "idle",
    messages: [
      {
        id: "long-context",
        type: "synthetic",
        time: { created: 1 },
        description:
          "pnpm storybook > /private/var/folders/0m/8pbhxmdx1c73_s21w3n7pcr40000gq/T/opencode/clever-planet-storybook.log 2>&1",
        text: "Storybook is ready at http://localhost:6006. The command is still running.",
      },
      {
        id: "long-system-context",
        type: "system",
        time: { created: 2 },
        description: "Session instructions loaded from /workspace/project/.opencode/AGENTS.md",
        text: "Follow the project instructions when making changes.",
      },
    ],
  },
  render: renderTranscript,
};

export const BackgroundProcesses: Story = {
  args: {
    sessionStatus: "idle",
    messages: [
      ...["completed", "error", "cancelled"].map((state, index) => {
        const command = 'export PATH="/node/bin:$PATH"\nnode --version\npnpm check && pnpm test';
        const output =
          state === "completed"
            ? "v24.20.0\nAll checks passed.\n\nCommand exited with code 0."
            : state === "error"
              ? "Command failed"
              : "Command cancelled because the server restarted";
        return {
          id: `background-${state}`,
          type: "synthetic" as const,
          time: { created: index + 1 },
          description: command,
          metadata: { source: "shell", shellID: `shell-${index}`, jobID: `job-${index}`, state },
          text: `<shell id="job-${index}" state="${state}" command="${command}">\n${output}\n</shell>`,
        };
      }),
      {
        id: "ordinary-context",
        type: "synthetic",
        time: { created: 4 },
        description: "Continuing after restart",
        text: "The previous work is preserved.",
      },
    ],
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const completed = canvas.getByRole("button", { name: /Background process.*Completed/ });
    await expect(completed).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByText(/All checks passed/)).toBeNull();
    completed.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText(/All checks passed/)).toBeVisible();
    await expect(canvasElement.querySelector(".transcript-background-command")).toHaveTextContent(
      'export PATH="/node/bin:$PATH"',
    );
    await expect(canvasElement.querySelector(".transcript-tool-output")).not.toHaveTextContent(
      "<shell",
    );
    await userEvent.keyboard(" ");
    await expect(completed).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(completed);
    await expect(canvas.getByText(/All checks passed/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Background process.*Failed/ }));
    await expect(canvas.getByText("Command failed")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Background process.*Cancelled/ }));
    await expect(canvas.getByText("Command cancelled because the server restarted")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Context Continuing after restart" }),
    ).toBeVisible();
  },
};

export const ContextOutsideActivity: Story = {
  args: {
    sessionStatus: "running",
    messages: [
      {
        ...assistant("before-context"),
        time: { created: 1, completed: 2 },
        content: [{ type: "reasoning", text: "The first cycle has finished." }],
      },
      {
        id: "restart-context",
        type: "synthetic",
        time: { created: 2 },
        description: "Continuing after restart",
        text: "The previous work is preserved. Continue from the last step.",
      },
      {
        ...assistant("after-context"),
        time: { created: 3 },
        finish: undefined,
        content: [{ type: "reasoning", text: "Continuing with the next cycle." }],
      },
    ],
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const context = canvas.getByRole("button", { name: "Context Continuing after restart" });
    await expect(context).toBeVisible();
    await expect(context.closest(".transcript-activity")).toBeNull();
    await expect(
      [...canvasElement.querySelectorAll<HTMLElement>(".transcript-document > *")].map(
        (element) => element.dataset.messageId,
      ),
    ).toEqual(["before-context", "restart-context", "after-context"]);
    await expect(
      [...canvasElement.querySelectorAll(".transcript-activity-title")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Thought", "Thinking"]);
    for (const activity of canvasElement.querySelectorAll(".transcript-activity-trigger")) {
      await expect(activity).toHaveAttribute("aria-expanded", "false");
    }
    context.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText(/The previous work is preserved/)).toBeVisible();
    await userEvent.keyboard(" ");
    await expect(context).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(context);
    await expect(canvas.getByText(/The previous work is preserved/)).toBeVisible();
  },
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

/** The parameter showing `text` verbatim, so an assertion cannot match another row. */
function findParameter(canvasElement: HTMLElement, text: string): HTMLElement {
  const parameter = [
    ...canvasElement.querySelectorAll<HTMLElement>(".transcript-tool-parameter"),
  ].find((element) => element.textContent === text);
  if (!parameter) throw new Error(`Tool parameter fixture is missing: ${text}`);
  return parameter;
}

/**
 * The box of one substring, which may sit outside its element when the row clips
 * the value. Measuring it shows which part of the value is visible.
 */
function substringRect(element: HTMLElement, text: string): DOMRect {
  const node = element.querySelector("bdi")?.firstChild ?? element.firstChild;
  const value = node?.nodeValue ?? "";
  const start = value.indexOf(text);
  if (node === null || start < 0) throw new Error(`Element does not contain: ${text}`);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  return range.getBoundingClientRect();
}

/** The box of an element's whole text, which extends past it while it clips. */
function contentRect(element: HTMLElement): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

// A table must fit its transcript column instead of scrolling inside it.
const tableTranscript: TranscriptViewProps["messages"] = [
  {
    id: "user-table",
    time: { created: 0 },
    type: "user",
    text: "Can you review the release checks?",
  },
  tableAssistant,
];

async function assertTableFits(canvasElement: HTMLElement): Promise<void> {
  const table = canvasElement.querySelector<HTMLTableElement>(".transcript-markdown table")!;
  const markdown = table.closest<HTMLElement>(".transcript-markdown")!;
  await expect(table.clientWidth).toBeGreaterThan(0);
  await expect(table.clientHeight).toBeGreaterThan(0);
  await expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth + 1);
  await expect(table.getBoundingClientRect().right).toBeLessThanOrEqual(
    markdown.getBoundingClientRect().right + 1,
  );
  await expect(markdown.scrollWidth).toBeLessThanOrEqual(markdown.clientWidth + 1);
}

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
    const rows = [...canvasElement.querySelectorAll(".transcript-message")];
    const distanceFromBottom = () =>
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    await waitFor(() => expect(distanceFromBottom()).toBeLessThan(2));
    canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!.click();
    const tool = canvas.getByRole("button", { name: "read README.md Running" });
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
    const activity = tool.closest(".transcript-activity")!;
    const activityHeader = activity.querySelector<HTMLButtonElement>(
      ".transcript-activity-trigger",
    )!;
    await expect(activityHeader).toHaveAttribute("aria-expanded", "false");
    activityHeader.click();
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
export const MarkdownTable: Story = {
  args: {
    messages: tableTranscript,
    sessionStatus: "idle",
    loading: false,
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => assertTableFits(canvasElement),
};
export const MarkdownTableNarrow: Story = {
  args: {
    messages: tableTranscript,
    sessionStatus: "idle",
    loading: false,
  },
  render: renderNarrowTranscript,
  play: async ({ canvasElement }) => assertTableFits(canvasElement),
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
export const ActivityStreaming: Story = {
  args: { messages: [], sessionStatus: "running" },
  render: () => <TranscriptActivityFixture />,
};
export const ActivityReasoning: Story = {
  args: {
    sessionStatus: "running",
    messages: [
      {
        id: "activity-reasoning",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test" },
        time: { created: 1 },
        content: [
          {
            type: "tool",
            id: "reasoning-read",
            name: "read",
            time: { created: 1, completed: 2 },
            state: {
              status: "completed",
              input: { path: "README.md" },
              content: [{ type: "text", text: "Project overview" }],
            },
          },
          { type: "reasoning", text: "Considering the next step.", time: { created: 3 } },
        ],
      },
    ],
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!;
    await expect(header.textContent).toBe("Read 1 file, thinking");
    await expect(header.querySelector(".transcript-activity-pulse")).toBeVisible();
  },
};
export const ActivityStreamingNarrow: Story = {
  ...ActivityStreaming,
  render: () => <TranscriptActivityFixture width="320px" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvasElement.querySelector<HTMLElement>(".transcript-activity")!;
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    await expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    await expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth + 1);

    canvas.getByRole("button", { name: "Finish turn" }).click();
    const title = canvasElement.querySelector<HTMLElement>(".transcript-activity-title")!;
    await waitFor(() => expect(title.textContent).toBe("Read 9 files, ran 5 searches, thought"));
    await expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    await expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth + 1);
  },
};
export const ActivityStreamingBehavior: Story = {
  ...ActivityStreaming,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    const activity = canvasElement.querySelector<HTMLElement>(".transcript-activity")!;
    const header = activity.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!;
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(header).toHaveTextContent("Read 9 files, ran 5 searches, thought");
    await expect(header.querySelector(".transcript-activity-pulse")).toBeVisible();
    header.click();
    const panel = activity.querySelector<HTMLElement>(".transcript-activity-content")!;
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(panel.clientHeight).toBeGreaterThan(viewport.clientHeight * 0.4));
    await expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight + 1);

    panel.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    canvas.getByRole("button", { name: "Add activity step" }).click();
    await settle();
    await expect(viewport.scrollTop).toBe(0);
    await expect(panel.scrollTop).toBe(0);

    canvas.getByRole("button", { name: "Complete model cycle" }).click();
    const headers = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".transcript-activity-trigger",
    );
    await expect(headers).toHaveLength(1);
    await expect(headers[0]).toBe(header);
    await expect(header.querySelector(".transcript-activity-pulse")).toBeVisible();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    header.click();
    canvas.getByRole("button", { name: "Add activity step" }).click();
    await expect(header).toHaveAttribute("aria-expanded", "false");

    canvas.getByRole("button", { name: "Finish turn" }).click();
    await waitFor(() => expect(header).toHaveAttribute("aria-expanded", "false"));
    await expect(header.querySelector(".transcript-activity-pulse")).toBeNull();
    await expect(header).toHaveTextContent("Read 11 files, ran 6 searches, thought");
    await expect(
      canvas.getByText("I checked the changed modules and found no blocking issue."),
    ).toBeVisible();
    header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  },
};
export const ActivitySelectionBehavior: Story = {
  ...ActivityStreaming,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!;
    header.click();
    const panel = canvasElement.querySelector<HTMLElement>(".transcript-activity-content")!;
    const tools = panel.querySelectorAll<HTMLButtonElement>(".transcript-tool-header");
    tools[tools.length - 1]!.click();
    const output = await waitFor(() => {
      const element = panel.querySelector<HTMLElement>(".transcript-tool-output");
      if (!element) throw new Error("Tool output did not open");
      return element;
    });
    panel.scrollTop = panel.scrollHeight;
    panel.dispatchEvent(new Event("scroll"));
    await settle();

    const selection = canvasElement.ownerDocument.getSelection()!;
    const range = canvasElement.ownerDocument.createRange();
    range.selectNodeContents(output);
    selection.removeAllRanges();
    selection.addRange(range);
    canvasElement.ownerDocument.dispatchEvent(new Event("selectionchange"));
    const readingPosition = panel.scrollTop;
    canvas.getByRole("button", { name: "Add activity step" }).click();
    await settle();
    await expect(panel.scrollTop).toBe(readingPosition);

    canvas.getByRole("button", { name: "Finish turn" }).click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    selection.removeAllRanges();
    canvasElement.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await expect(header).toHaveAttribute("aria-expanded", "false");
  },
};
export const ActivityWithPendingRequest: Story = {
  args: { messages: [], sessionStatus: "running" },
  render: () => <TranscriptActivityFixture pending />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Read 9 files, ran 5 searches, thought" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(canvasElement.querySelector("[data-permission-request-id]")).not.toBeNull();
  },
};
export const FailedStates: Story = {
  args: {
    messages: [assistant("assistant-failed", "error")],
    sessionStatus: "idle",
    loading: false,
  },
  render: renderTranscript,
};

export const Retrying: Story = {
  args: {
    messages: [
      {
        ...assistant("assistant-retry", "error"),
        content: [{ type: "text", text: "I checked the changes. Continuing verification…" }],
        error: { type: "provider.transport", message: "WebSocket closed with code 1000" },
        retry: {
          attempt: 3,
          at: 1,
          error: { type: "provider.transport", message: "WebSocket closed with code 1000" },
        },
      },
    ],
    sessionStatus: "running",
    connected: true,
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Retrying, attempt 3")).toBeVisible();
    await expect(canvas.queryByText("WebSocket closed with code 1000")).toBeNull();
  },
};

export const DisconnectedDuringRetry: Story = {
  ...Retrying,
  args: { ...Retrying.args, connected: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Disconnected")).toBeVisible();
  },
};

export const FailedAfterRetry: Story = {
  ...Retrying,
  args: { ...Retrying.args, sessionStatus: "idle" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Failed: WebSocket closed with code 1000"),
    ).toBeVisible();
  },
};

export const RetryingBeforeOutput: Story = {
  args: {
    messages: [
      {
        ...assistant("assistant-retry-before-output"),
        time: { created: 1 },
        finish: undefined,
        content: [],
        retry: {
          attempt: 2,
          at: 1,
          error: { type: "provider.internal", message: "Provider unavailable", status: 503 },
        },
      },
    ],
    sessionStatus: "running",
  },
  render: renderNarrowTranscript,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Retrying, attempt 2")).toBeVisible();
    await expect(canvas.queryByText("503")).toBeNull();
  },
};

export const ProviderUnavailable: Story = {
  args: {
    messages: [
      {
        ...assistant("assistant-unavailable", "error"),
        content: [],
        error: { type: "provider.internal", message: "Upstream unavailable", status: 503 },
      },
    ],
    sessionStatus: "idle",
  },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Provider unavailable")).toBeVisible();
  },
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
  play: async ({ canvasElement, step }) => {
    for (const header of canvasElement.querySelectorAll<HTMLButtonElement>(
      ".transcript-activity-trigger",
    )) {
      if (header.getAttribute("aria-expanded") !== "true") await userEvent.click(header);
    }
    await step("Shows a parameter that fits the row in full", async () => {
      const parameter = findParameter(canvasElement, midLengthToolPath);
      // The row owns clipping: a value over the header's old 64-character cap is
      // handed over whole and shown whole while the column has room for it.
      await expect(parameter.textContent).toBe(midLengthToolPath);
      await expect(parameter.scrollWidth).toBeLessThanOrEqual(parameter.clientWidth + 1);
    });
  },
};
export const AllToolParameters: Story = {
  args: { messages: [allParameterTools], sessionStatus: "idle", loading: false },
  render: renderTranscript,
  play: async ({ canvasElement, step }) => {
    await userEvent.click(
      canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!,
    );
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    const container = view.parentElement!;
    const headers = [
      ...canvasElement.querySelectorAll<HTMLButtonElement>(".transcript-tool-header"),
    ];
    await expect(
      headers.map((header) => header.querySelector(".transcript-tool-name")!.textContent),
    ).toEqual(allParameterTools.content.map((tool) => tool.type === "tool" && tool.name));
    for (const width of [260, 390, 820, 1440]) {
      await step(`All tool names stay readable at ${width}px`, async () => {
        container.style.width = `${width}px`;
        await settle();
        for (const header of headers) {
          const name = header.querySelector<HTMLElement>(".transcript-tool-name")!;
          const parameter = header.querySelector<HTMLElement>(".transcript-tool-parameter")!;
          await expect(parameter).not.toBeNull();
          const nameBox = name.getBoundingClientRect();
          const textBox = contentRect(name);
          const parameterBox = parameter.getBoundingClientRect();
          const statusBox = header
            .querySelector(".transcript-tool-status")!
            .getBoundingClientRect();
          const lineHeight = Number.parseFloat(getComputedStyle(name).lineHeight);
          await expect(nameBox.height).toBeLessThanOrEqual(lineHeight + 1);
          await expect(textBox.left).toBeGreaterThanOrEqual(nameBox.left - 1);
          await expect(textBox.right).toBeLessThanOrEqual(nameBox.right + 1);
          await expect(parameterBox.left).toBeGreaterThanOrEqual(nameBox.right + 7);
          await expect(parameterBox.width).toBeGreaterThan(0);
          await expect(parameterBox.height).toBeLessThanOrEqual(lineHeight + 1);
          await expect(statusBox.left).toBeGreaterThanOrEqual(parameterBox.right + 7);
          await expect(statusBox.right).toBeLessThanOrEqual(
            header.getBoundingClientRect().right + 1,
          );
          await expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
        }
        await expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth + 1);
      });
    }
    // Each tool still opens and closes with keyboard activation.
    for (const header of headers) {
      header.focus();
      await userEvent.keyboard("{Enter}");
      await expect(header).toHaveAttribute("aria-expanded", "true");
      await userEvent.keyboard("{Enter}");
      await expect(header).toHaveAttribute("aria-expanded", "false");
    }
  },
};
export const ToolImageLongMetadata: Story = {
  args: { messages: toolStates, sessionStatus: "idle", loading: false },
  render: renderNarrowTranscript,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Keeps long tool parameters on one line inside the column", async () => {
      for (const activity of canvasElement.querySelectorAll<HTMLButtonElement>(
        ".transcript-activity-trigger",
      )) {
        if (activity.getAttribute("aria-expanded") !== "true") await userEvent.click(activity);
      }
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
        // Long parameters must shrink before short tool names wrap or get clipped.
        const name = header.querySelector<HTMLElement>(".transcript-tool-name")!;
        const nameBox = name.getBoundingClientRect();
        const nameText = contentRect(name);
        await expect(nameBox.height).toBeLessThanOrEqual(lineHeight + 1);
        await expect(nameText.left).toBeGreaterThanOrEqual(nameBox.left - 1);
        await expect(nameText.right).toBeLessThanOrEqual(nameBox.right + 1);
        await expect(nameBox.right).toBeLessThanOrEqual(parameter.getBoundingClientRect().left - 7);
        // A parameter holding the whole row leaves the running loader at the row's
        // edge, where its rotated box overhangs its 14px layout box by ~3px. Rows
        // without one have no such excuse.
        const spinning = header.querySelector(".transcript-tool-loader") !== null;
        await expect(header.scrollWidth).toBeLessThanOrEqual(
          header.clientWidth + (spinning ? 6 : 1),
        );
      }
      const icon = canvasElement.querySelector<HTMLElement>(
        '.transcript-tool-header > [data-slot="icon-svg"]',
      );
      if (!icon) throw new Error("Tool icon is missing");
      // The parameter absorbs the row's slack, so the icon keeps its own size.
      await expect(Math.round(icon.getBoundingClientRect().width)).toBe(14);
    });
    await step("Keeps the file name and the command head visible while clipping", async () => {
      const path = findParameter(canvasElement, longToolPath);
      const pathBox = path.getBoundingClientRect();
      // A path keeps its file name: the tail sits inside the row, and the clipped
      // directory prefix runs out of the row's start instead of its end.
      const file = substringRect(path, "ToolCall.tsx");
      await expect(file.left).toBeGreaterThanOrEqual(pathBox.left - 1);
      await expect(file.right).toBeLessThanOrEqual(pathBox.right + 1);
      await expect(contentRect(path).left).toBeLessThan(pathBox.left - 1);

      const command = findParameter(canvasElement, longToolCommand);
      const commandBox = command.getBoundingClientRect();
      // Everything that is not a path keeps its head, so the command stays read-
      // able and only its flags are clipped away.
      await expect(substringRect(command, "pnpm").left).toBeGreaterThanOrEqual(commandBox.left - 1);
      await expect(contentRect(command).right).toBeGreaterThan(commandBox.right + 1);
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
export const LongToolNamesNarrow: Story = {
  args: { messages: [longNamedTools], sessionStatus: "idle", loading: false },
  render: (args) => (
    <div style={{ width: "420px", height: "100vh", background: "var(--oc-surface-canvas)" }}>
      <TranscriptView {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!,
    );
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    for (const suffix of longToolNameSuffixes) {
      const trigger = canvas.getByRole("button", {
        name: `${longToolNamePrefix}${suffix} Completed`,
      });
      const name = trigger.querySelector<HTMLElement>(".transcript-tool-name")!;
      const copy = trigger.querySelector<HTMLElement>(".transcript-tool-copy")!;
      const suffixBox = substringRect(name, suffix);
      const copyBox = copy.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      // A text-content assertion alone passes even when the distinguishing tail is clipped.
      await expect(suffixBox.width).toBeGreaterThan(0);
      await expect(suffixBox.left).toBeGreaterThanOrEqual(copyBox.left - 1);
      await expect(suffixBox.right).toBeLessThanOrEqual(copyBox.right + 1);
      await expect(suffixBox.top).toBeGreaterThanOrEqual(copyBox.top - 1);
      await expect(suffixBox.bottom).toBeLessThanOrEqual(copyBox.bottom + 1);
      await expect(name.getBoundingClientRect().height).toBeGreaterThan(
        Number.parseFloat(getComputedStyle(name).lineHeight),
      );
      const icons = trigger.querySelectorAll<HTMLElement>('[data-slot="icon-svg"]');
      await expect(icons).toHaveLength(2);
      for (const icon of icons) {
        const box = icon.getBoundingClientRect();
        await expect(Math.round(box.width)).toBe(14);
        await expect(Math.round(box.height)).toBe(14);
        await expect(box.left).toBeGreaterThanOrEqual(triggerBox.left - 1);
        await expect(box.right).toBeLessThanOrEqual(triggerBox.right + 1);
        await expect(box.top).toBeGreaterThanOrEqual(triggerBox.top - 1);
        await expect(box.bottom).toBeLessThanOrEqual(triggerBox.bottom + 1);
      }
      await userEvent.click(trigger);
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(canvas.getByText(`Result for ${suffix}`)).toBeVisible();
    }
    // Only known tools have a parameter summary; keep that existing path-tail contract.
    const parameter = canvasElement.querySelector<HTMLElement>(".transcript-tool-parameter")!;
    const box = parameter.getBoundingClientRect();
    const tail = substringRect(parameter, "README.md");
    await expect(contentRect(parameter).left).toBeLessThan(box.left - 1);
    await expect(box.height).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(parameter).lineHeight) + 1,
    );
    await expect(tail.left).toBeGreaterThanOrEqual(box.left - 1);
    await expect(tail.right).toBeLessThanOrEqual(box.right + 1);
    await expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth + 1);
  },
};

export const ShellStates: Story = {
  args: { messages: shellStates, sessionStatus: "idle" },
  render: renderTranscript,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Annotated output remains keyboard-focusable without an outline", async () => {
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
      await expect(getComputedStyle(output).outlineStyle).toBe("none");
    });
    await step("Wraps a long command inside the transcript column", async () => {
      const label = [
        ...canvasElement.querySelectorAll<HTMLElement>(".transcript-context-label"),
      ].find((element) => element.textContent === longShellCommand);
      if (!label) throw new Error("Long command fixture is missing");
      const trigger = label.closest<HTMLElement>(".transcript-context-trigger");
      if (!trigger) throw new Error("Shell row is missing");
      const labelBox = label.getBoundingClientRect();
      // A command is the row's own content: it stays readable in full and wraps,
      // so the row never paints past the transcript column.
      await expect(trigger.scrollWidth).toBeLessThanOrEqual(trigger.clientWidth + 1);
      await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
      const command = substringRect(label, longShellCommand);
      await expect(command.left).toBeGreaterThanOrEqual(labelBox.left - 1);
      await expect(command.right).toBeLessThanOrEqual(labelBox.right + 1);
      await expect(label.getBoundingClientRect().height).toBeGreaterThan(
        Number.parseFloat(getComputedStyle(label).lineHeight),
      );
    });
  },
};
export const ActivityStates: Story = {
  args: { messages: [], sessionStatus: "running" },
  render: () => <ActivityStatesFixture />,
  play: async ({ canvasElement }) => {
    // The transcript mounts its newest rows first and materializes the rest.
    await waitFor(() =>
      expect(canvasElement.querySelectorAll(".transcript-activity-trigger")).toHaveLength(29),
    );
    const headers = [
      ...canvasElement.querySelectorAll<HTMLElement>(".transcript-activity-trigger"),
    ].map((header) => header.textContent);
    await expect(headers).toEqual([
      "Read 1 file",
      "Read 3 files",
      "Wrote 1 file",
      "Updated 2 files",
      "Applied 1 patch",
      "Ran 2 searches",
      "Fetched 1 page",
      "Ran 1 command",
      "Delegated 1 task",
      "Loaded 1 skill",
      "Asked 1 question",
      "Used 2 other tools",
      "Read 6 files, ran 1 search, 3 commands, started 2 commands, delegated 2 tasks, loaded 1 skill, asked 1 question, used 1 other tool",
      "Used 1 other tool",
      "Read 1 file, used 1 other tool",
      "Used 2 other tools",
      "Read 1 file",
      "Started 1 command",
      "Ran 1 command",
      "Ran 1 command",
      "Thought for 1 s",
      "Ran 2 commands",
      "Read 1 file",
      "Thought for 3 s",
      "Read 1 file, thought for 3 s",
      "Thought",
      "Running",
      "Running",
      "Running",
    ]);
    const canvas = within(canvasElement);
    for (const activity of canvasElement.querySelectorAll<HTMLButtonElement>(
      ".transcript-activity-trigger",
    )) {
      await expect(activity).toHaveAttribute("aria-expanded", "false");
    }
    for (const [index, command] of ["pnpm slow", "pnpm tests"].entries()) {
      const activity = canvasElement.querySelector<HTMLButtonElement>(
        `[data-message-id="turn-${index + 18}"] .transcript-activity-trigger`,
      )!;
      await userEvent.click(activity);
      const tool = canvas.getByRole("button", { name: `shell ${command} Failed` });
      await expect(within(tool).getByText("Failed")).toBeVisible();
      await userEvent.click(tool);
      await expect(tool).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(tool);
      await expect(tool).toHaveAttribute("aria-expanded", "false");
    }
    const background = canvasElement.querySelector<HTMLButtonElement>(
      '[data-message-id="turn-17"] .transcript-activity-trigger',
    )!;
    await userEvent.click(background);
    await expect(canvas.getByRole("button", { name: "shell pnpm watch Running" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "shell pnpm watch Completed" })).toBeNull();
  },
};
export const ActivityStatesNarrow: Story = {
  args: { messages: [], sessionStatus: "running" },
  render: () => <ActivityStatesFixture width="320px" />,
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    await waitFor(() =>
      expect(canvasElement.querySelectorAll(".transcript-activity-trigger")).toHaveLength(29),
    );
    await expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth + 1);
    // A run spanning many kinds of work stays on one line, with the complete
    // summary available on hover when the narrow column clips it.
    const label = [
      ...canvasElement.querySelectorAll<HTMLElement>(".transcript-activity-title"),
    ].find((title) => title.textContent?.startsWith("Read 6 files, ran 1 search, 3 commands"));
    if (!label) throw new Error("The mixed activity label is missing");
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    await expect(label.getAttribute("title")).toBe(label.textContent);
    await expect(contentRect(label).height).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(label).lineHeight) + 1,
    );
  },
};
export const CompactionStates: Story = {
  args: { messages: compactionStates, sessionStatus: "idle" },
  render: renderTranscript,
};
export const InterleavedActivity: Story = {
  args: { messages: interleavedActivity, sessionStatus: "idle" },
  render: renderTranscript,
  play: async ({ canvasElement }) => {
    // The shell after the model switch is a continuation run: it renders as a
    // top-level Activity wrapper rather than a row of its own.
    await expect(
      [...canvasElement.querySelectorAll<HTMLElement>(".transcript-document > *")].map(
        (element) => element.dataset.messageId ?? "activity",
      ),
    ).toEqual([
      "interleaved-prompt",
      "interleaved-first",
      "interleaved-model",
      "activity",
      "interleaved-second",
      "interleaved-agent",
      "interleaved-third",
    ]);
    const labels = [
      ...canvasElement.querySelectorAll<HTMLElement>(".transcript-activity-title"),
    ].map((title) => title.textContent);
    await expect(labels).toEqual(["Read 1 file", "Ran 1 command", "Ran 1 search", "Read 1 file"]);
  },
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
    for (const activity of canvasElement.querySelectorAll<HTMLButtonElement>(
      ".transcript-activity-trigger",
    )) {
      if (activity.getAttribute("aria-expanded") === "false") await userEvent.click(activity);
    }
    for (const name of [
      "read Streaming",
      "grep TranscriptView Running",
      "apply_patch Completed",
      "bash pnpm build Failed",
      "skill release-checklist Completed",
      "pnpm watch Killed",
      "Compaction manual Failed",
      "Review · 2",
      "Annotations · 1",
    ]) {
      await userEvent.click(canvas.getByRole("button", { name }));
    }
    await expect(canvas.getByText("Output truncated", { exact: true })).toBeInTheDocument();
    await expect(
      canvas.getByText("The provider is unavailable. Try again.", { exact: true }),
    ).toBeInTheDocument();
    await expect(
      screen.getByText("Which changes did you check?", { exact: true }),
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
    await userEvent.click(oldest.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!);
    const trigger = within(oldest).getByRole("button", {
      name: /release-check Completed/,
    });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/migrations: ready/)).toBeInTheDocument();
  },
};

export const ReturnToLatest: Story = {
  args: { messages: longTranscript, sessionStatus: "idle", loading: false },
  render: renderConstrainedTranscript,
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    if (!view) throw new Error("Transcript viewport is missing");
    await waitFor(() =>
      expect(canvasElement.querySelectorAll("[data-message-id]")).toHaveLength(
        longTranscript.length,
      ),
    );
    await waitFor(() => expect(view).toHaveAttribute("aria-busy", "false"));
    const control = () => canvasElement.querySelector<HTMLElement>(".transcript-scroll-to-bottom");
    await expect(control()).toBeNull();

    // The reader leaves the newest rows and receives the control.
    view.scrollTop = 0;
    view.dispatchEvent(new Event("scroll"));
    const button = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(".transcript-scroll-to-bottom");
      if (!element) throw new Error("The return-to-latest control did not appear");
      return element;
    });

    // Using it restores the bottom and dismisses the control; focus stays in
    // the transcript because the control unmounts on arrival.
    await userEvent.click(button);
    await waitFor(() => expect(control()).toBeNull());
    await waitFor(() =>
      expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeLessThan(2),
    );
    await expect(view).toHaveFocus();
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
    // Let newly relevant content render and any observer work settle before
    // recording the reading position.
    await settle();
    const baselineCount = rows().length;
    if (baselineCount >= longAnchorTranscript.length) {
      throw new Error("Materialization finished before the anchor was recorded");
    }
    const bounds = view.getBoundingClientRect();
    const anchor = [...rows()].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
    if (!anchor) throw new Error("No fully visible row to anchor");
    const anchorTop = anchor.getBoundingClientRect().top;
    await expect(view.style.overflowAnchor).toBe("auto");

    await waitFor(() => expect(rows()).toHaveLength(longAnchorTranscript.length));
    await waitFor(() => expect(view).toHaveAttribute("aria-busy", "false"));
    await settle();

    // The reading anchor survived the older batches.
    await expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(8);
    // The viewport was not dragged back to the bottom.
    await expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeGreaterThan(10);
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

// A single unbroken line guarantees horizontal overflow regardless of width.
const wideOutputLine = `result:${"0123456789abcdef".repeat(40)}`;

export const WideOutputScrolling: Story = {
  args: {
    messages: [
      ...longTranscript,
      {
        id: "wide-shell",
        type: "shell",
        shellID: "wide",
        time: { created: 1_000, completed: 1_001 },
        command: "cat wide.txt",
        status: "exited",
        exit: 0,
        output: {
          output: wideOutputLine,
          cursor: wideOutputLine.length,
          size: wideOutputLine.length,
          truncated: false,
        },
      },
    ],
    sessionStatus: "idle",
    loading: false,
  },
  render: renderNarrowTranscript,
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    if (!view) throw new Error("Transcript viewport is missing");
    await waitFor(() => expect(view).toHaveAttribute("aria-busy", "false"));

    const row = canvasElement.querySelector<HTMLElement>('[data-message-id="wide-shell"]');
    if (!row) throw new Error("Shell row is missing");
    const trigger = row.querySelector<HTMLButtonElement>(".transcript-context-trigger");
    if (!trigger) throw new Error("Shell trigger is missing");
    await userEvent.click(trigger);

    const pre = await waitFor(() => {
      const candidate = row.querySelector<HTMLElement>(".transcript-tool-output");
      if (!candidate) throw new Error("Shell output is not mounted");
      return candidate;
    });
    // Containment must not swallow the output's own horizontal scrolling.
    await waitFor(() => expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth + 4));
    pre.scrollLeft = 40;
    await expect(pre.scrollLeft).toBeGreaterThan(0);

    // The row is skipped while offscreen and rendered again on return; its
    // inner scroll container has to keep working.
    const viewRect = view.getBoundingClientRect();
    view.scrollTop = 0;
    await waitFor(() => expect(row.getBoundingClientRect().top).toBeGreaterThan(viewRect.bottom));
    row.scrollIntoView({ block: "center" });
    await waitFor(() => expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth + 4));
    pre.scrollLeft = 0;
    pre.scrollLeft = 40;
    await expect(pre.scrollLeft).toBeGreaterThan(0);
  },
};
