import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  TranscriptView,
  type TranscriptViewProps,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import type { TranscriptMessage } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/transcript-types.ts";

const richItems = [
  {
    kind: "user",
    id: "user-1",
    text: "Can you review the release notes and call out the risks before we ship?",
  },
  {
    kind: "assistant",
    id: "assistant-1",
    state: "complete",
    blocks: [
      {
        kind: "paragraph",
        content: [
          "I reviewed the release notes and the related changes. The release looks ready with two items worth watching: ",
          { kind: "link", text: "the migration guide", href: "https://example.com/migration" },
          " should be updated, and the background job needs a final smoke test.",
        ],
      },
      { kind: "heading", level: 2, content: "What changed" },
      {
        kind: "list",
        items: [
          "The new session view keeps the transcript readable as responses stream in.",
          "Tool output is available inline when a check needs investigation.",
          "Failed responses preserve their visible text and explain the state.",
        ],
      },
      {
        kind: "quote",
        content: "Small, observable changes are easier to ship and easier to recover.",
      },
      {
        kind: "reasoning",
        label: "Reasoning summary",
        duration: "11s",
        summary: "Compared the changed paths with the release checklist.",
        defaultOpen: true,
      },
      {
        kind: "tool",
        name: "release-check",
        toolKind: "command",
        target: "release checklist",
        detail: "3 checks",
        status: "done",
        output: "migrations: ready\nbackground job: passed\ndocs: follow-up recommended",
        defaultExpanded: true,
      },
      {
        kind: "paragraph",
        content: "Recommendation: ship after the smoke test, then follow up on the docs.",
      },
    ],
  },
] as const satisfies readonly TranscriptMessage[];

const meta = {
  title: "Transcript/TranscriptView",
  component: TranscriptView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TranscriptView>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderTranscript = (args: TranscriptViewProps) => (
  <div style={{ height: "100vh", "min-height": "520px", background: "#121212" }}>
    <TranscriptView {...args} />
  </div>
);

export const Rich: Story = {
  args: { items: richItems, loading: false, working: false },
  render: renderTranscript,
};

export const Loading: Story = {
  args: { items: [], loading: true, working: false },
  render: renderTranscript,
};

export const Empty: Story = {
  args: { items: [], loading: false, working: false },
  render: renderTranscript,
};

export const Failure: Story = {
  args: {
    items: [],
    loading: false,
    error: "This transcript could not be loaded. Check the connection and try again.",
    onRetry: () => undefined,
  },
  render: renderTranscript,
};

export const Streaming: Story = {
  args: {
    items: [
      richItems[0],
      {
        kind: "assistant",
        id: "assistant-streaming",
        state: "streaming",
        blocks: [
          { kind: "paragraph", content: "I am checking the latest changes now…" },
          {
            kind: "tool",
            name: "git-diff",
            toolKind: "command",
            target: "working tree",
            status: "running",
          },
        ],
      },
    ],
    loading: false,
    workingLabel: "Generating the transcript…",
    working: true,
  },
  render: renderTranscript,
};

export const ExpandedReasoning: Story = {
  args: {
    items: [
      {
        kind: "assistant",
        id: "assistant-reasoning",
        state: "complete",
        blocks: [
          {
            kind: "reasoning",
            label: "Reasoning summary",
            duration: "11s",
            summary: "Reviewed layout metrics and validated the spacing tokens.",
            defaultOpen: true,
          },
          {
            kind: "tool",
            name: "Read file",
            toolKind: "read",
            target: "src/layout/App.tsx",
            detail: "12 lines",
            status: "done",
          },
          {
            kind: "tool",
            name: "Search code",
            toolKind: "search",
            target: "layout density",
            detail: "14 matches",
            status: "done",
          },
          {
            kind: "tool",
            name: "Run command",
            toolKind: "command",
            target: "pnpm test",
            detail: "3 suites passed",
            status: "done",
          },
          {
            kind: "tool",
            name: "Follow-up",
            toolKind: "generic",
            detail: "Review required",
            status: "done",
          },
        ],
      },
    ],
    loading: false,
    working: false,
  },
  render: renderTranscript,
};

export const FailedStates: Story = {
  args: {
    items: [
      {
        kind: "assistant",
        id: "assistant-failed",
        state: "failed",
        blocks: [
          { kind: "paragraph", content: "The verification could not finish." },
          {
            kind: "tool",
            name: "test-runner",
            toolKind: "command",
            target: "pnpm test",
            detail: "exit code 1",
            status: "failed",
          },
        ],
      },
    ],
    loading: false,
    working: false,
  },
  render: renderTranscript,
};

export const DescriptiveWorking: Story = {
  args: {
    items: [],
    loading: false,
    working: true,
    workingLabel: "Generating visual regression report…",
  },
  render: renderTranscript,
};
