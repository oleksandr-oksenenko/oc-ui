import type { SessionMessageInfo } from "@opencode-ai/client";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  TranscriptView,
  type TranscriptViewProps,
} from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { createSessionPrompt } from "../src/renderer/opencode/session-prompt.ts";

const assistant = (
  id: string,
  status: "completed" | "error" = "completed",
): SessionMessageInfo => ({
  id,
  time: { created: 2, completed: 3 },
  type: "assistant",
  agent: "build",
  model: { providerID: "openai", id: "gpt-5" },
  content: [
    {
      type: "text",
      text:
        status === "error"
          ? "The verification could not finish."
          : "I reviewed the release notes and the related changes.",
    },
    {
      type: "reasoning",
      text: "Compared the changed paths with the release checklist.",
      time: { created: 2, completed: 3 },
    },
    {
      type: "tool",
      id: `${id}-tool`,
      name: "release-check",
      time: { created: 2, ran: 2, completed: 3 },
      state:
        status === "error"
          ? {
              status: "error",
              input: { command: "pnpm test" },
              error: { type: "test", message: "One suite failed", status: 1 },
              content: [{ type: "text", text: "Failure output" }],
            }
          : {
              status: "completed",
              input: { command: "pnpm test" },
              content: [
                { type: "text", text: "migrations: ready\nbackground job: passed" },
                {
                  type: "file",
                  uri: "file:///tmp/report.txt",
                  mime: "text/plain",
                  name: "report.txt",
                },
              ],
            },
    },
  ],
  ...(status === "error"
    ? { finish: "error" as const, error: { type: "test", message: "One suite failed", status: 1 } }
    : { finish: "stop" as const }),
});

const streamingAssistant: SessionMessageInfo = {
  id: "assistant-streaming",
  time: { created: 12 },
  type: "assistant",
  agent: "build",
  model: { providerID: "openai", id: "gpt-5" },
  content: [
    { type: "text", text: "I am checking the latest changes now…" },
    { type: "reasoning", text: "Reviewing the changed paths.", time: { created: 12 } },
    {
      type: "tool",
      id: "assistant-streaming-tool",
      name: "git-diff",
      time: { created: 12, ran: 12 },
      state: { status: "running", input: { command: "git diff" }, metadata: {} },
    },
  ],
};

const markdownAssistant: SessionMessageInfo = {
  id: "assistant-markdown",
  time: { created: 1, completed: 2 },
  type: "assistant",
  agent: "build",
  model: { providerID: "openai", id: "gpt-5" },
  content: [
    {
      type: "text",
      text: [
        "# Release review",
        "",
        "The release is **ready to ship**. The remaining notes are *informational*.",
        "",
        "## What changed",
        "",
        "- Added Markdown rendering",
        "- Sanitized generated HTML",
        "- Styled `inline code` and code blocks",
        "",
        "> All required checks passed. No blocking issues remain.",
        "",
        "```ts",
        'const release = { status: "ready", checks: 3 };',
        "```",
        "",
        "| Check | Status |",
        "| --- | --- |",
        "| Types | Passed |",
        "| Tests | Passed |",
        "| Build | Passed |",
        "",
        "Read the [release notes](https://example.com/releases) for the full details.",
      ].join("\n"),
    },
  ],
  finish: "stop",
};

const richItems: readonly SessionMessageInfo[] = [
  { id: "system-1", time: { created: 0 }, type: "system", text: "System context" },
  {
    id: "user-1",
    time: { created: 1 },
    type: "user",
    text: "Can you review the release notes?",
    files: [
      { data: "omitted", mime: "text/plain", source: { type: "inline" }, name: "release.md" },
    ],
  },
  assistant("assistant-1"),
  {
    id: "shell-1",
    time: { created: 4, completed: 5 },
    type: "shell",
    shellID: "shell-1",
    command: "pnpm test",
    status: "exited",
    exit: 0,
    output: { output: "3 suites passed", cursor: 14, size: 14, truncated: false },
  },
  {
    id: "skill-1",
    time: { created: 6 },
    type: "skill",
    skill: "review",
    name: "Review checklist",
    text: "Check migrations and docs.",
  },
  { id: "agent-1", time: { created: 7 }, type: "agent-switched", agent: "plan", previous: "build" },
  {
    id: "model-1",
    time: { created: 8 },
    type: "model-switched",
    model: { providerID: "openai", id: "gpt-5" },
  },
  {
    id: "location-1",
    time: { created: 9 },
    type: "location-switched",
    location: { directory: "/workspace" },
  },
  {
    id: "compaction-1",
    time: { created: 10 },
    type: "compaction",
    status: "completed",
    reason: "auto",
    summary: "Conversation summarized.",
    recent: "Recent release discussion.",
  },
  {
    id: "synthetic-1",
    time: { created: 11 },
    type: "synthetic",
    text: "Generated context",
    description: "Inserted by the session",
  },
];

const reviewPrompt = createSessionPrompt({
  instruction: "Please address these before merging.",
  annotations: [],
  reviewComments: [
    {
      path: "src/renderer/components/Workspace.tsx",
      body: "Keep the controlled state in the workspace owner.",
      selection: { start: 18, side: "deletions", end: 20, endSide: "additions" },
      selectedCode: "const local = createSignal(false);\nconst open = props.open;\n",
    },
    {
      path: "src/renderer/components/Composer.tsx",
      body: "Reuse the existing sendability predicate here.",
      selection: { start: 74, end: 74 },
      selectedCode: "const canSubmit = () => !props.disabled;\n",
    },
  ],
});

const meta = {
  title: "Transcript/TranscriptView",
  component: TranscriptView,
  args: { sessionID: "transcript-story" },
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
