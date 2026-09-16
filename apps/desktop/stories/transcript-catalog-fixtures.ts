import type { SessionMessageInfo } from "@opencode/client";
import { createSessionPrompt } from "../src/renderer/opencode/session-prompt.ts";
import { previewImageBase64, previewImageMime } from "./image-fixtures.ts";

export const assistant = (
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

export const streamingAssistant: SessionMessageInfo = {
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

export const markdownAssistant: SessionMessageInfo = {
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
        "3. Review the changes",
        "4. Publish the release",
        "",
        "> All required checks passed. No blocking issues remain.",
        "",
        "```ts",
        'const release = { status: "ready", checks: 3 };',
        "```",
        "",
        "| Check | Status |",
        "| --- | --- |",
        "| Type checking and static analysis | All checks passed without errors |",
        "| Tests | Passed |",
        "| Build | Passed |",
        "",
        "Read the [release notes](https://example.com/releases) for the full details.",
      ].join("\n"),
    },
  ],
  finish: "stop",
};

export const richItems: readonly SessionMessageInfo[] = [
  { id: "system-1", time: { created: 0 }, type: "system", text: "System context" },
  {
    id: "user-1",
    time: { created: 1 },
    type: "user",
    text: "Can you review the release notes?",
    files: [
      {
        data: previewImageBase64,
        mime: previewImageMime,
        source: { type: "inline" },
        name: "preview.png",
      },
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

export const reviewPrompt = createSessionPrompt({
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

const reviewMessage: SessionMessageInfo = {
  id: "sent-code-review",
  type: "user",
  time: { created: 13 },
  text: reviewPrompt.text,
  metadata: reviewPrompt.metadata,
};

export const toolStates: readonly SessionMessageInfo[] = [
  {
    id: "tool-states",
    type: "assistant",
    time: { created: 14 },
    agent: "build",
    model: { providerID: "openai", id: "gpt-5" },
    content: [
      {
        type: "tool",
        id: "streaming-input",
        name: "read",
        time: { created: 14 },
        state: { status: "streaming", input: '{"path":"src/renderer/' },
      },
      {
        type: "tool",
        id: "running-search",
        name: "grep",
        time: { created: 14, ran: 14 },
        state: { status: "running", input: { pattern: "TranscriptView" }, metadata: {} },
      },
      {
        type: "tool",
        id: "completed-edit",
        name: "apply_patch",
        time: { created: 14, ran: 14, completed: 15 },
        state: {
          status: "completed",
          input: { path: "src/renderer/styles.css" },
          content: [{ type: "text", text: "Updated 1 file." }],
        },
      },
      {
        type: "tool",
        id: "failed-command",
        name: "bash",
        time: { created: 14, ran: 14, completed: 15 },
        state: {
          status: "error",
          input: { command: "pnpm build" },
          error: { type: "command", message: "Build exited with code 1", status: 1 },
        },
      },
      {
        type: "tool",
        id: "image-output",
        name: "browser_capture",
        time: { created: 14, ran: 14, completed: 15 },
        state: {
          status: "completed",
          input: { tab: "preview" },
          content: [
            {
              // A long, unbreakable name and mime exercise the tool-file row
              // layout under metadata wider than the transcript column.
              type: "file",
              name: "browser_capture_full_page_with_devtools_overlay_final_v2.apng",
              mime: "image/vnd.mozilla.apng",
              uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
            },
            { type: "file", mime: "application/json", uri: "file:///tmp/report.json" },
          ],
        },
      },
    ],
  },
];

export const shellStates: readonly SessionMessageInfo[] = [
  {
    id: "shell-running",
    type: "shell",
    shellID: "running",
    time: { created: 16 },
    command: "pnpm dev",
    status: "running",
  },
  {
    id: "shell-success",
    type: "shell",
    shellID: "success",
    time: { created: 16, completed: 17 },
    command: "pnpm check",
    status: "exited",
    exit: 0,
    output: { output: "No errors found.", cursor: 16, size: 16, truncated: false },
  },
  {
    id: "shell-error",
    type: "shell",
    shellID: "error",
    time: { created: 16, completed: 17 },
    command: "pnpm test",
    status: "exited",
    exit: 1,
    output: { output: "Expected 200, received 500.", cursor: 25, size: 25, truncated: false },
  },
  {
    id: "shell-timeout",
    type: "shell",
    shellID: "timeout",
    time: { created: 16, completed: 17 },
    command: "curl --max-time 10 localhost:3000",
    status: "timeout",
    output: { output: "Connection timed out.", cursor: 20, size: 20, truncated: false },
  },
  {
    id: "shell-killed",
    type: "shell",
    shellID: "killed",
    time: { created: 16, completed: 17 },
    command: "pnpm watch",
    status: "killed",
    output: { output: "Last lines of the watch log…", cursor: 4096, size: 4096, truncated: true },
  },
];

export const compactionStates: readonly SessionMessageInfo[] = [
  {
    id: "compaction-running",
    type: "compaction",
    time: { created: 18 },
    status: "running",
    reason: "manual",
    summary: "Summarizing the conversation…",
    recent: "Recent changes are being preserved.",
  },
  {
    id: "compaction-complete",
    type: "compaction",
    time: { created: 18 },
    status: "completed",
    reason: "auto",
    summary: "Updated the transcript layout and checked the release.",
    recent: "Next: verify the workspace.",
  },
  {
    id: "compaction-failed",
    type: "compaction",
    time: { created: 18 },
    status: "failed",
    reason: "manual",
    error: { type: "provider", message: "The provider is unavailable. Try again." },
  },
];

const annotationPrompt = createSessionPrompt({
  instruction: "Please clarify this part.",
  reviewComments: [],
  annotations: [
    {
      id: "annotation-example",
      quote: "I reviewed the release notes and the related changes.",
      body: "Which changes did you check?",
      source: {
        messageID: "assistant-1",
        block: "content/0/text",
        textDigest: "0".repeat(64),
        start: 0,
        end: 51,
      },
    },
  ],
});
const annotationMessage: SessionMessageInfo = {
  id: "sent-annotation",
  type: "user",
  time: { created: 19 },
  text: annotationPrompt.text,
  metadata: annotationPrompt.metadata,
  agents: [{ name: "review" }],
  skills: [{ id: "release-checklist", name: "Release checklist" }],
};

// Every message kind and renderer branch is represented here. Mutually exclusive
// lifecycle states also have focused stories so they can be inspected independently.
export const allTranscriptElements: readonly SessionMessageInfo[] = [
  ...richItems,
  markdownAssistant,
  reviewMessage,
  annotationMessage,
  ...toolStates,
  ...shellStates,
  ...compactionStates,
  assistant("assistant-failed", "error"),
  streamingAssistant,
];

// A long transcript whose newest suffix mounts first and whose older rows arrive
// in batches; used to exercise progressive materialization in a real browser.
export const longTranscript: readonly SessionMessageInfo[] = [
  assistant("long-oldest", "completed"),
  ...Array.from({ length: 119 }, (_, index) => ({
    id: `long-${index + 1}`,
    time: { created: 1 },
    type: "user" as const,
    text: `Materialized message ${index + 1}`,
  })),
];

// A longer, uniformly shaped transcript used to hold materialization open while
// browser scroll anchoring and text selection are exercised. The newest row is
// a disclosure so the scrollable region has keyboard-focusable content. Sized so
// a 50-row batch policy still leaves several batches after the play interacts.
export const longAnchorTranscript: readonly SessionMessageInfo[] = [
  ...Array.from({ length: 499 }, (_, index) => ({
    id: `anchor-${index}`,
    time: { created: 1 },
    type: "user" as const,
    text: `Anchored message ${index}`,
  })),
  assistant("anchor-tool", "completed"),
];
