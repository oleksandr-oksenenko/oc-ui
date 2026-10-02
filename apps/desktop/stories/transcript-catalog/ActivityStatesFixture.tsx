import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client";

import { TranscriptView } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";

/**
 * Every Activity header state in one transcript, so operation labels
 * and neutral fallbacks can be reviewed together. Each caption is the prompt
 * of its own turn; the last turn stays live.
 */

type Content = Exclude<SessionMessageAssistant["content"][number], { type: "text" }>;
type Metadata = Readonly<Record<string, string | number | boolean>>;

const done = { created: 1, completed: 2 };
const streaming = { created: 1 };

const tool = (id: string, name: string, metadata?: Metadata): SessionMessageAssistantTool => {
  const base = {
    type: "tool",
    id,
    name,
    time: done,
    state: {
      status: "completed",
      input: { path: `src/${id}.ts`, command: `pnpm ${id}` },
      content: [{ type: "text", text: `${id} finished` }],
    },
  } satisfies SessionMessageAssistantTool;
  return metadata === undefined ? base : { ...base, state: { ...base.state, metadata } };
};

const failedTool = (id: string): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "check",
  time: done,
  state: {
    status: "error",
    input: { command: `pnpm ${id}` },
    error: { type: "tool", message: `${id} failed` },
  },
});

const failedRead = (id: string): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "read",
  time: done,
  state: {
    status: "error",
    input: { path: `src/${id}.ts` },
    error: { type: "tool", message: `${id} not found` },
  },
});

const reasoning: Content = { type: "reasoning", text: "Weighing the options", time: done };

const exitedShell = (id: string, exit: number): SessionMessageInfo => ({
  id,
  type: "shell",
  time: done,
  shellID: id,
  command: `pnpm ${id}`,
  status: "exited",
  exit,
  output: { output: `${id} output`, cursor: 10, size: 10, truncated: false },
});

const runningShell = (id: string): SessionMessageInfo => ({
  id,
  type: "shell",
  time: streaming,
  shellID: id,
  command: `pnpm ${id}`,
  status: "running",
});

const injectedContext: SessionMessageInfo = {
  id: "context",
  type: "synthetic",
  time: streaming,
  text: "Inserted context",
  description: "Inserted by the session",
};

const modelSwitch: SessionMessageInfo = {
  id: "model",
  type: "model-switched",
  time: streaming,
  model: { providerID: "openai", id: "gpt-5" },
  previous: { providerID: "openai", id: "gpt-4" },
};

const locationSwitch: SessionMessageInfo = {
  id: "location",
  type: "location-switched",
  time: streaming,
  location: { directory: "/workspace/oc-ui" },
};

const compaction: SessionMessageInfo = {
  id: "compaction",
  type: "compaction",
  time: streaming,
  status: "completed",
  reason: "auto",
  summary: "Summarized the conversation.",
  recent: "Recent changes are preserved.",
};

type State = {
  readonly caption: string;
  readonly content?: readonly Content[];
  /** Transcript rows that group into this turn's Activity. */
  readonly details?: readonly SessionMessageInfo[];
  /** Transcript rows that stay top level in this turn. */
  readonly after?: readonly SessionMessageInfo[];
};

const states: readonly State[] = [
  { caption: "Single read", content: [tool("app", "read")] },
  { caption: "Repeated reads", content: [tool("a", "read"), tool("b", "read"), tool("c", "read")] },
  { caption: "Write", content: [tool("notes", "write")] },
  { caption: "Two edits", content: [tool("first", "edit"), tool("second", "edit")] },
  { caption: "Patch", content: [tool("release", "patch")] },
  { caption: "Glob and grep", content: [tool("files", "glob"), tool("usage", "grep")] },
  { caption: "Web fetch", content: [tool("docs", "webfetch")] },
  {
    caption: "Shell command",
    content: [tool("check", "shell", { status: "completed", exit: 0 })],
  },
  { caption: "Subagent", content: [tool("explore", "subagent")] },
  { caption: "Skill", content: [tool("review", "skill")] },
  { caption: "Question", content: [tool("choice", "question")] },
  {
    caption: "Unknown tools",
    content: [tool("mcp__one", "mcp__one"), tool("mcp__two", "mcp__two")],
  },
  {
    caption: "Several operations",
    content: [
      ...Array.from({ length: 6 }, (_, index) => tool(`read-${index}`, "read")),
      tool("usage", "grep"),
      ...Array.from({ length: 3 }, (_, index) => tool(`command-${index}`, "shell")),
      ...Array.from({ length: 2 }, (_, index) =>
        tool(`background-${index}`, "shell", { status: "running" }),
      ),
      tool("explore", "subagent"),
      tool("verify", "subagent"),
      tool("review", "skill"),
      tool("choice", "question"),
      tool("custom", "custom"),
    ],
  },
  { caption: "Only a failure", content: [failedTool("check")] },
  { caption: "Work and a failure", content: [tool("app", "read"), failedTool("tests")] },
  { caption: "Two failures", content: [failedTool("first"), failedTool("second")] },
  { caption: "A failed read", content: [failedRead("missing")] },
  {
    caption: "Command still in the background",
    content: [tool("watch", "shell", { status: "running" })],
  },
  {
    caption: "Command timed out",
    content: [tool("slow", "shell", { status: "completed", timeout: true })],
  },
  {
    caption: "Command exited nonzero",
    content: [tool("tests", "shell", { status: "completed", exit: 1 })],
  },
  { caption: "Reasoning only", content: [reasoning] },
  { caption: "Injected context only", details: [injectedContext] },
  { caption: "Two shell rows", details: [exitedShell("first", 0), exitedShell("second", 0)] },
  {
    caption: "Switch, location and compaction rows",
    content: [tool("app", "read")],
    after: [modelSwitch, locationSwitch, compaction],
  },
  // Last: the transcript's final turn stays live while the session is running.
  { caption: "Live: running command", details: [runningShell("watch")] },
];

const messages: readonly SessionMessageInfo[] = states.flatMap(
  (state, index): SessionMessageInfo[] => {
    const live = index === states.length - 1;
    return [
      { id: `caption-${index}`, type: "user" as const, time: streaming, text: state.caption },
      {
        id: `turn-${index}`,
        type: "assistant" as const,
        agent: "build",
        model: { providerID: "openai", id: "gpt-5" },
        time: live ? streaming : done,
        content: [...(state.content ?? [])],
        finish: "tool-calls" as const,
      },
      ...(state.details ?? []),
      ...(state.after ?? []),
    ];
  },
);

export function ActivityStatesFixture(props: { readonly width?: string }) {
  return (
    <div
      style={{
        width: props.width ?? "100%",
        "min-height": "100vh",
        background: "var(--oc-surface-canvas)",
      }}
    >
      <TranscriptView sessionID="activity-states" messages={messages} sessionStatus="running" />
    </div>
  );
}
