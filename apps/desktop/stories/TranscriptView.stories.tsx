/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  TranscriptView,
  type TranscriptViewProps,
} from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import {
  assistant,
  streamingAssistant,
  markdownAssistant,
  richItems,
  reviewPrompt,
  allTranscriptElements,
  toolStates,
  shellStates,
  compactionStates,
} from "./transcript-catalog-fixtures.ts";
import { TranscriptPendingFixture } from "./transcript-catalog/TranscriptPendingFixture.tsx";

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

export const Rich: Story = {
  args: { messages: richItems, sessionStatus: "idle", loading: false },
  render: renderTranscript,
};
export const Markdown: Story = {
  args: { messages: [markdownAssistant], sessionStatus: "idle", loading: false },
  render: renderTranscript,
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
export const ShellStates: Story = {
  args: { messages: shellStates, sessionStatus: "idle" },
  render: renderTranscript,
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
      "grep Running",
      "apply_patch Completed",
      "bash Error",
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
