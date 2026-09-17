import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client";
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { stubResizeObserver } from "../../../../../test/resize-observer.ts";
import { createAnnotationHighlights } from "../createAnnotationHighlights.ts";
import { TranscriptView } from "./TranscriptView.tsx";
import { TOOL_PARAMETER_LIMIT } from "./TranscriptView/AssistantMessage/toolParameter.ts";
import { UserMessage } from "./TranscriptView/UserMessage.tsx";
import { CODE_REVIEW_METADATA_KEY } from "../../../../../opencode/code-review.ts";

import { createSessionPrompt } from "../../../../../opencode/session-prompt.ts";

const base = { created: 1 };
const assistant = (
  id: string,
  status: "streaming" | "running" | "completed" | "error",
): SessionMessageAssistantTool => ({
  type: "tool" as const,
  id,
  name: "check",
  time: base,
  state:
    status === "streaming"
      ? { status, input: "raw input" }
      : status === "running"
        ? { status, input: { command: "check" }, metadata: {} }
        : status === "completed"
          ? {
              status,
              input: { command: "check" },
              content: [
                { type: "text" as const, text: "passed" },
                {
                  type: "file" as const,
                  uri: "file:///tmp/report.txt",
                  mime: "text/plain",
                  name: "report.txt",
                },
              ],
            }
          : { status, input: { command: "check" }, error: { type: "tool", message: "failed" } },
});

function renderUserMessage(message: SessionMessageUser) {
  return mount(() => <UserMessage message={message} />);
}

function selectNodeContents(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function userMessages(prefix: string, count: number): SessionMessageInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    time: base,
    type: "user" as const,
    text: `${prefix}${index}`,
  }));
}

function toolAssistantMessage(id: string, toolID: string): SessionMessageAssistant {
  return {
    id,
    time: base,
    type: "assistant",
    agent: "build",
    model: { providerID: "p", id: "m" },
    content: [assistant(toolID, "completed")],
  };
}

function textAssistantMessage(id: string, text: string): SessionMessageAssistant {
  return {
    id,
    time: base,
    type: "assistant",
    agent: "build",
    model: { providerID: "p", id: "m" },
    content: [{ type: "text", text }],
  };
}

function stubAnimationFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++next;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  return {
    pending: () => frames.size,
    runNext: () => {
      const entry = [...frames.entries()][0];
      if (entry === undefined) throw new Error("No pending animation frame");
      frames.delete(entry[0]);
      entry[1](0);
    },
    runAll: () => {
      let guard = 0;
      while (frames.size > 0) {
        if (++guard > 1000) throw new Error("animation frame loop did not settle");
        const entry = [...frames.entries()][0]!;
        frames.delete(entry[0]);
        entry[1](0);
      }
    },
  };
}

describe("TranscriptView", () => {
  it("preserves message rows and expanded tools across appends and status changes", () => {
    stubResizeObserver();
    const [messages, setMessages] = createStore<SessionMessageAssistant[]>([
      {
        id: "response",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test" },
        content: [assistant("tool", "running")],
      },
    ]);
    const [status, setStatus] = createSignal<"running" | "idle">("running");
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus={status()} />
    ));
    const row = host.querySelector('[data-message-id="response"]')!;
    const trigger = host.querySelector<HTMLButtonElement>(".transcript-tool-header")!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    setMessages(0, "content", 0, assistant("tool", "completed"));
    expect(row.textContent).toContain("passed");
    setMessages(messages.length, {
      id: "next",
      agent: "build",
      model: { providerID: "test", id: "test" },
      time: base,
      type: "assistant",
      content: [{ type: "text", text: "Done" }],
    });
    expect(host.querySelector('[data-message-id="response"]')).toBe(row);
    expect(host.querySelector(".transcript-tool-header")).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    setStatus("idle");
    expect(host.querySelector('[data-message-id="response"]')).toBe(row);
    expect(row.getAttribute("data-state")).toBe("complete");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    setStatus("running");
    expect(row.getAttribute("data-state")).toBe("streaming");
    expect(host.querySelectorAll(".transcript-message")).toHaveLength(2);

    dispose();
    vi.unstubAllGlobals();
  });

  it("releases annotation listeners when the transcript unmounts", () => {
    stubResizeObserver();
    const detach = vi.fn<() => void>();
    const attach = vi.fn<(element: HTMLDivElement) => () => void>(() => detach);
    const { host, dispose } = mount(() => (
      <TranscriptView
        sessionID="session"
        messages={[]}
        sessionStatus="idle"
        annotationRootRef={attach}
      />
    ));
    expect(attach).toHaveBeenCalledWith(host.firstElementChild);
    expect(detach).not.toHaveBeenCalled();
    dispose();
    expect(detach).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("renders a pending interaction after transcript messages", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      {
        id: "user",
        time: base,
        type: "user",
        text: "Prompt",
      },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView
        sessionID="session"
        messages={messages}
        sessionStatus="idle"
        pendingInteraction={<form data-testid="pending-interaction">Choose a workspace</form>}
      />
    ));

    const documentChildren = [...host.querySelectorAll<HTMLElement>(".transcript-document > *")];
    expect(documentChildren.at(-1)?.dataset.testid).toBe("pending-interaction");
    expect(documentChildren.at(-1)?.textContent).toBe("Choose a workspace");

    dispose();
    vi.unstubAllGlobals();
  });

  it("renders a pending interaction instead of the empty transcript state", () => {
    stubResizeObserver();
    const { host, dispose } = mount(() => (
      <TranscriptView
        sessionID="session"
        messages={[]}
        sessionStatus="idle"
        pendingInteraction={<form>Choose a workspace</form>}
      />
    ));

    expect(host.querySelector(".transcript-empty-state")).toBeNull();
    expect(host.querySelector("form")?.textContent).toBe("Choose a workspace");

    dispose();
    vi.unstubAllGlobals();
  });

  it("renders every SDK message variant and preserves assistant source order", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      {
        id: "user",
        time: base,
        type: "user",
        text: "Prompt",
        files: [
          { data: "secret", mime: "text/plain", source: { type: "inline" }, name: "notes.txt" },
        ],
        agents: [{ name: "reviewer" }],
        skills: [{ id: "review", name: "Review skill" }],
      },
      {
        id: "assistant",
        time: { ...base, completed: 2 },
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [
          { type: "text", text: "Before" },
          { type: "reasoning", text: "Think" },
          assistant("streaming", "streaming"),
          { type: "text", text: "After" },
        ],
      },
      {
        id: "shell",
        time: base,
        type: "shell",
        shellID: "shell",
        command: "echo hi",
        status: "exited",
        exit: 0,
        output: { output: "hi", cursor: 2, size: 2, truncated: false },
      },
      {
        id: "skill",
        time: base,
        type: "skill",
        skill: "review",
        name: "Review",
        text: "Skill text",
      },
      { id: "agent", time: base, type: "agent-switched", agent: "plan" },
      { id: "model", time: base, type: "model-switched", model: { providerID: "p", id: "m" } },
      { id: "location", time: base, type: "location-switched", location: { directory: "/tmp" } },
      {
        id: "compaction",
        time: base,
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "Summary",
        recent: "Recent",
      },
      { id: "system", time: base, type: "system", text: "System" },
      { id: "synthetic", time: base, type: "synthetic", text: "Synthetic" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));

    expect(host.textContent).toContain("notes.txt");
    expect(host.textContent).toContain("reviewer");
    expect(host.textContent).toContain("Review skill");
    expect(host.textContent).toContain("Before");
    expect(host.textContent).toContain("After");
    expect(host.textContent).toContain("echo hi");
    expect(host.textContent).toContain("Skill: Review");
    expect(host.textContent).toContain("Agent switched");
    expect(host.textContent).toContain("Model switched");
    expect(host.textContent).toContain("Location switched");
    expect(host.textContent).toContain("Compaction");
    expect(
      host.querySelector(".transcript-shell-exited .transcript-context-status")?.textContent,
    ).toBe("Completed");
    expect(
      host
        .querySelector(".transcript-shell-exited .transcript-context-status")
        ?.getAttribute("data-status"),
    ).toBe("success");
    expect(
      host.querySelector(".transcript-compaction-completed .transcript-context-status")
        ?.textContent,
    ).toBe("Completed");
    expect(
      host
        .querySelector(".transcript-compaction-completed .transcript-context-status")
        ?.getAttribute("data-status"),
    ).toBe("success");
    expect(host.textContent).toContain("System context");
    expect(host.textContent).toContain("Context");
    expect(host.textContent).not.toContain("secret");
    expect(
      [...host.querySelectorAll<HTMLElement>(".transcript-document > [data-message-id]")].map(
        (element) => element.dataset.messageId,
      ),
    ).toEqual([
      "user",
      "assistant",
      "shell",
      "skill",
      "agent",
      "model",
      "location",
      "compaction",
      "system",
      "synthetic",
    ]);
    const assistantParts = [
      ...host.querySelectorAll<HTMLElement>(
        '[data-message-id="assistant"] .transcript-assistant-document > *',
      ),
    ];
    expect(
      assistantParts.map((element) =>
        element.classList.contains("transcript-reasoning")
          ? "reasoning"
          : element.classList.contains("transcript-tool-call")
            ? "tool"
            : element.textContent,
      ),
    ).toEqual(["Before", "reasoning", "tool", "After"]);
    const reasoningTrigger = host.querySelector<HTMLButtonElement>(
      ".transcript-reasoning .transcript-context-trigger",
    );
    expect(reasoningTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(reasoningTrigger?.textContent).toBe("Reasoning");
    expect(host.querySelector(".transcript-reasoning-summary")).toBeNull();
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-slot="collapsible-trigger"]')].every(
        (trigger) => trigger.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
    expect(
      [
        ...host.querySelectorAll<HTMLElement>(
          ".transcript-reasoning, .transcript-tool-call, .transcript-shell-message, .transcript-skill-message, .transcript-compaction, .transcript-context-message",
        ),
      ].every((element) => element.dataset.component === "collapsible"),
    ).toBe(true);
    expect(host.querySelector(".transcript-reasoning svg")).not.toBeNull();
    dispose();
    vi.unstubAllGlobals();
  });

  it("omits turn idle markers while keeping their surrounding rows", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      { id: "user", time: base, type: "user", text: "Prompt" },
      { id: "idle-succeeded", time: base, type: "idle", outcome: "succeeded" },
      textAssistantMessage("assistant", "Answer"),
      { id: "idle-failed", time: base, type: "idle", outcome: "failed" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));

    expect(host.textContent).toContain("Prompt");
    expect(host.textContent).toContain("Answer");
    expect(
      [...host.querySelectorAll<HTMLElement>(".transcript-document > [data-message-id]")].map(
        (element) => element.dataset.messageId,
      ),
    ).toEqual(["user", "assistant"]);
    dispose();
    vi.unstubAllGlobals();
  });

  it("collapses reasoning by default and reveals its text on demand", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      {
        id: "assistant-reasoning",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [
          {
            type: "reasoning",
            text: "Working through it",
            time: { created: 1_000, completed: 4_000 },
          },
        ],
      },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const trigger = host.querySelector<HTMLButtonElement>(
      ".transcript-reasoning .transcript-context-trigger",
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("Reasoning");
    expect(host.querySelector(".transcript-reasoning-summary")).toBeNull();

    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".transcript-reasoning-summary")?.textContent).toBe(
      "Working through it",
    );
    expect(
      host.querySelector(".transcript-reasoning-summary")?.getAttribute("data-annotation-block"),
    ).toBe('["content",0,"reasoning"]');

    dispose();
    vi.unstubAllGlobals();
  });

  it("keeps expanded reasoning open while streamed text arrives", () => {
    stubResizeObserver();
    const [messages, setMessages] = createStore<SessionMessageAssistant[]>([
      {
        id: "assistant-reasoning",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [{ type: "reasoning", text: "First thought" }],
      },
    ]);
    const [status, setStatus] = createSignal<"running" | "idle">("running");
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus={status()} />
    ));
    const trigger = host.querySelector<HTMLButtonElement>(
      ".transcript-reasoning .transcript-context-trigger",
    )!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    setMessages(0, "content", 0, { type: "reasoning", text: "First thought and more" });
    expect(host.querySelector(".transcript-reasoning .transcript-context-trigger")).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".transcript-reasoning-summary")?.textContent).toBe(
      "First thought and more",
    );

    setMessages(0, "content", 1, { type: "text", text: "Done" });
    setStatus("idle");
    expect(host.querySelector(".transcript-reasoning .transcript-context-trigger")).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    dispose();
    vi.unstubAllGlobals();
  });

  it("keeps collapsed tool and reasoning content unmounted until first expansion", () => {
    stubResizeObserver();
    const [messages, setMessages] = createStore<SessionMessageAssistant[]>([
      {
        id: "assistant",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [{ type: "reasoning", text: "First thought" }, assistant("tool", "completed")],
      },
    ]);
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="running" />
    ));
    const reasoning = host.querySelector<HTMLElement>(".transcript-reasoning")!;
    const tool = host.querySelector<HTMLElement>(".transcript-tool-call")!;
    expect(reasoning.querySelector('[data-slot="collapsible-content"]')).toBeNull();
    expect(tool.querySelector('[data-slot="collapsible-content"]')).toBeNull();
    expect(host.querySelector(".transcript-reasoning-summary")).toBeNull();

    const toolTrigger = tool.querySelector<HTMLButtonElement>(".transcript-tool-header")!;
    toolTrigger.click();
    const toolContent = tool.querySelector<HTMLElement>('[data-slot="collapsible-content"]')!;
    expect(toolContent.querySelector(".transcript-tool-details")).not.toBeNull();
    expect(
      [...toolContent.querySelectorAll<HTMLElement>(".transcript-tool-output")].map((element) =>
        element.getAttribute("data-annotation-block"),
      ),
    ).toEqual(['["tool","tool","input"]', '["tool","tool","output",0,"text"]']);
    expect(host.querySelector(".transcript-reasoning-summary")).toBeNull();

    setMessages(0, "content", 1, assistant("tool", "error"));
    expect(tool.querySelector('[data-slot="collapsible-content"]')).toBe(toolContent);
    expect(tool.classList.contains("transcript-tool-error")).toBe(true);
    expect(toolContent.querySelector(".transcript-tool-details")).not.toBeNull();
    expect(tool.querySelector(".transcript-tool-header")).toBe(toolTrigger);

    dispose();
    vi.unstubAllGlobals();
  });

  it("shows the parameter once the input is parsed and updates it in place", () => {
    stubResizeObserver();
    const path =
      "src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/AssistantMessage/ToolCall.tsx";
    const [messages, setMessages] = createStore<SessionMessageAssistant[]>([
      {
        id: "assistant",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [
          {
            type: "tool",
            id: "tool",
            name: "read",
            time: base,
            state: { status: "streaming", input: '{"path":"src/renderer/' },
          },
        ],
      },
    ]);
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="running" />
    ));
    const row = host.querySelector<HTMLElement>('[data-message-id="assistant"]')!;
    // Streamed input text is never inspected.
    expect(row.querySelector(".transcript-tool-parameter")).toBeNull();

    setMessages(0, "content", 0, {
      type: "tool",
      id: "tool",
      name: "read",
      time: base,
      state: { status: "running", input: { path, offset: 1 }, metadata: {} },
    });
    const span = row.querySelector<HTMLElement>(".transcript-tool-parameter");
    if (!span) throw new Error("Tool parameter did not render");
    const text = span.textContent ?? "";
    expect(text.length).toBeLessThanOrEqual(TOOL_PARAMETER_LIMIT);
    expect(text.endsWith("…")).toBe(true);

    setMessages(0, "content", 0, {
      type: "tool",
      id: "tool",
      name: "read",
      time: base,
      state: {
        status: "completed",
        input: { path: "src/app.ts", offset: 1 },
        content: [{ type: "text", text: "done" }],
      },
    });
    expect(row.querySelector(".transcript-tool-parameter")).toBe(span);
    expect(span.textContent).toBe("src/app.ts");

    setMessages(0, "content", 0, {
      type: "tool",
      id: "tool",
      name: "read",
      time: base,
      state: { status: "running", input: { offset: 1 }, metadata: {} },
    });
    expect(row.querySelector(".transcript-tool-parameter")).toBeNull();

    dispose();
    vi.unstubAllGlobals();
  });

  it("defers the initial resume to the next animation frame", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      { id: "message", time: base, type: "user", text: "Prompt" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const transcript = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(transcript, "scrollHeight", { get: () => 500, configurable: true });
    transcript.scrollTop = 0;

    expect(frames.pending()).toBe(1);
    expect(transcript.scrollTop).toBe(0);

    frames.runNext();
    expect(transcript.scrollTop).toBe(500);

    dispose();
    vi.unstubAllGlobals();
  });

  it("cancels a stale resume when the next session starts loading, then resumes it when ready", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const [sessionID, setSessionID] = createSignal("first");
    const [loading, setLoading] = createSignal(false);
    const messages: readonly SessionMessageInfo[] = [
      { id: "message", time: base, type: "user", text: "Prompt" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView
        sessionID={sessionID()}
        messages={messages}
        sessionStatus="idle"
        loading={loading()}
      />
    ));
    const transcript = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(transcript, "scrollHeight", { get: () => 500, configurable: true });
    transcript.scrollTop = 0;

    expect(frames.pending()).toBe(1);
    expect(transcript.scrollTop).toBe(0);

    // Loading the next session before the first frame runs must not leave the
    // previous session's resume pending.
    batch(() => {
      setSessionID("second");
      setLoading(true);
    });
    expect(frames.pending()).toBe(0);

    // Reset the viewport to observe the new session's deferred resume.
    transcript.scrollTop = 0;
    setLoading(false);
    expect(frames.pending()).toBe(1);
    frames.runNext();
    expect(transcript.scrollTop).toBe(500);

    dispose();
    vi.unstubAllGlobals();
  });

  it("cancels a still-pending resume when the transcript unmounts", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      { id: "message", time: base, type: "user", text: "Prompt" },
    ];
    const { dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));

    expect(frames.pending()).toBe(1);
    dispose();
    expect(frames.pending()).toBe(0);
    vi.unstubAllGlobals();
  });

  it("does not override a user scroll that lands before the scheduled resume", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      { id: "message", time: base, type: "user", text: "Prompt" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const transcript = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(transcript, "scrollHeight", { get: () => 500, configurable: true });
    transcript.scrollTop = 0;

    expect(frames.pending()).toBe(1);
    transcript.scrollTop = 120;
    transcript.dispatchEvent(new Event("scroll"));

    expect(frames.pending()).toBe(0);
    expect(transcript.scrollTop).toBe(120);

    dispose();
    vi.unstubAllGlobals();
  });

  it("does not resume while the user has an active selection", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      { id: "message", time: base, type: "user", text: "Prompt" },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const transcript = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(transcript, "scrollHeight", { get: () => 500, configurable: true });
    transcript.scrollTop = 0;

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(transcript);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(frames.pending()).toBe(1);
    frames.runNext();
    expect(transcript.scrollTop).toBe(0);

    selection.removeAllRanges();
    dispose();
    vi.unstubAllGlobals();
  });

  it("materializes a long transcript from its newest rows and settles to the full list", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages = userMessages("m", 60);
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const view = host.querySelector<HTMLElement>(".transcript-view")!;
    const rowCount = () => host.querySelectorAll("[data-message-id]").length;
    try {
      expect(view.getAttribute("aria-busy")).toBe("true");
      expect(rowCount()).toBe(20);
      expect(host.querySelector('[data-message-id="m59"]')).not.toBeNull();
      expect(host.querySelector('[data-message-id="m0"]')).toBeNull();

      frames.runAll();

      expect(rowCount()).toBe(60);
      expect(host.querySelector('[data-message-id="m0"]')).not.toBeNull();
      expect(view.getAttribute("aria-busy")).toBe("false");
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps rendered row and expanded disclosure identity while older batches prepend", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      ...userMessages("m", 59),
      toolAssistantMessage("newest", "tool-newest"),
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    try {
      const row = host.querySelector<HTMLElement>('[data-message-id="newest"]')!;
      const trigger = row.querySelector<HTMLButtonElement>(".transcript-tool-header")!;
      trigger.click();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");

      frames.runAll();

      expect(host.querySelectorAll("[data-message-id]")).toHaveLength(60);
      expect(host.querySelector('[data-message-id="newest"]')).toBe(row);
      expect(row.querySelector(".transcript-tool-header")).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector('[data-message-id="m0"]')).not.toBeNull();
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("restarts materialization for a new session and cancels the previous pending work", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const [sessionID, setSessionID] = createSignal("first");
    const [messages, setMessages] = createSignal(userMessages("a", 60));
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID={sessionID()} messages={messages()} sessionStatus="idle" />
    ));
    try {
      expect(host.querySelectorAll("[data-message-id]")).toHaveLength(20);
      expect(host.querySelector('[data-message-id="a0"]')).toBeNull();

      batch(() => {
        setSessionID("second");
        setMessages(userMessages("b", 40));
      });

      const switched = [...host.querySelectorAll<HTMLElement>("[data-message-id]")];
      expect(switched).toHaveLength(20);
      expect(switched.every((row) => row.dataset.messageId?.startsWith("b"))).toBe(true);

      frames.runAll();

      expect(
        [...host.querySelectorAll<HTMLElement>("[data-message-id]")].map(
          (row) => row.dataset.messageId,
        ),
      ).toEqual(userMessages("b", 40).map((message) => message.id));
    } finally {
      dispose();
      expect(frames.pending()).toBe(0);
      vi.unstubAllGlobals();
    }
  });

  it("preserves a user scroll position while older batches materialize", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages = userMessages("m", 60);
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const view = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(view, "scrollHeight", { get: () => 500, configurable: true });
    view.scrollTop = 120;
    try {
      // The user scrolls away before the deferred resume runs.
      view.dispatchEvent(new Event("scroll"));

      frames.runAll();

      expect(host.querySelectorAll("[data-message-id]")).toHaveLength(60);
      expect(view.scrollTop).toBe(120);
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("exposes older annotation source blocks once materialization completes", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      textAssistantMessage("old", "An older passage."),
      ...userMessages("m", 25),
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    try {
      expect(host.querySelector('[data-message-id="old"] [data-annotation-block]')).toBeNull();

      frames.runAll();

      const block = host.querySelector<HTMLElement>(
        '[data-message-id="old"] [data-annotation-block]',
      );
      expect(block).not.toBeNull();
      expect(block?.textContent).toContain("An older passage.");
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("settles aria-busy with an error and stays idle for an empty transcript", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const errored = mount(() => (
      <TranscriptView
        sessionID="errored"
        messages={userMessages("m", 60)}
        sessionStatus="idle"
        error="Could not load"
      />
    ));
    try {
      const view = errored.host.querySelector<HTMLElement>(".transcript-view")!;
      expect(view.getAttribute("aria-busy")).toBe("true");
      frames.runAll();
      expect(view.getAttribute("aria-busy")).toBe("false");
      expect(errored.host.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
    } finally {
      errored.dispose();
    }

    const empty = mount(() => (
      <TranscriptView sessionID="empty" messages={[]} sessionStatus="idle" />
    ));
    try {
      expect(empty.host.querySelector(".transcript-view")?.getAttribute("aria-busy")).toBe("false");
      expect(empty.host.querySelector(".transcript-empty-state")).not.toBeNull();
    } finally {
      empty.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("pauses follow-bottom only for selections inside the transcript viewport", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages = userMessages("m", 170);
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));
    const view = host.querySelector<HTMLElement>(".transcript-view")!;
    Object.defineProperty(view, "scrollHeight", { get: () => 500, configurable: true });
    const outside = document.createElement("p");
    outside.textContent = "Composer text";
    document.body.append(outside);
    try {
      // Follow mode disables browser scroll anchoring.
      expect(view.style.overflowAnchor).toBe("none");

      frames.runNext(); // deferred resume
      frames.runNext(); // first older batch
      expect(host.querySelectorAll("[data-message-id]")).toHaveLength(70);

      // A selection in another pane must not pause this transcript.
      selectNodeContents(outside);
      expect(view.style.overflowAnchor).toBe("none");

      // The upstream interaction policy releases follow-bottom only for this
      // transcript's own selection.
      selectNodeContents(host.querySelector('[data-message-id="m100"]')!);
      expect(view.style.overflowAnchor).toBe("auto");

      frames.runAll();
      expect(host.querySelectorAll("[data-message-id]")).toHaveLength(170);
      window.getSelection()?.removeAllRanges();
    } finally {
      outside.remove();
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps each large-session switch bounded to the initial suffix", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const first = userMessages("a", 120);
    const second = userMessages("b", 120);
    const [sessionID, setSessionID] = createSignal("a");
    const [messages, setMessages] = createSignal<readonly SessionMessageInfo[]>(first);
    const attribute = vi.spyOn(Element.prototype, "setAttribute");
    try {
      const { dispose } = mount(() => (
        <TranscriptView sessionID={sessionID()} messages={messages()} sessionStatus="idle" />
      ));
      frames.runAll();

      // Selection and the SDK list arrive in separate updates, as in the workspace.
      const switchTo = (session: string, list: readonly SessionMessageInfo[]) => {
        attribute.mockClear();
        setSessionID(session);
        setMessages(list);
        const rows = attribute.mock.calls.filter(([name]) => name === "data-message-id").length;
        frames.runAll();
        return rows;
      };

      // Repeated switches must not reorder into a full-history mount.
      expect(switchTo("b", second)).toBeLessThanOrEqual(20);
      expect(switchTo("a", first)).toBeLessThanOrEqual(20);
      expect(switchTo("b", second)).toBeLessThanOrEqual(20);

      dispose();
    } finally {
      attribute.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps one selection listener across materializing batches and removes it at completion", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const selectionAdds = () =>
      add.mock.calls.filter(([type]) => type === "selectionchange").length;
    const selectionRemoves = () =>
      remove.mock.calls.filter(([type]) => type === "selectionchange").length;
    try {
      const messages = userMessages("m", 80);
      const { host, dispose } = mount(() => (
        <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
      ));
      expect(selectionAdds()).toBe(1);
      expect(selectionRemoves()).toBe(0);

      let stableAcrossBatches = true;
      let guard = 0;
      while (host.querySelectorAll("[data-message-id]").length < messages.length) {
        if (++guard > 20) throw new Error("materialization did not settle");
        frames.runNext();
        if (host.querySelectorAll("[data-message-id]").length < messages.length) {
          // Advancing batches must not detach and reattach the listener.
          stableAcrossBatches =
            stableAcrossBatches && selectionAdds() === 1 && selectionRemoves() === 0;
        }
      }

      expect(stableAcrossBatches).toBe(true);
      expect(selectionAdds()).toBe(1);
      expect(selectionRemoves()).toBe(1);
      dispose();
      expect(selectionAdds()).toBe(1);
      expect(selectionRemoves()).toBe(1);
    } finally {
      add.mockRestore();
      remove.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("makes a temporarily missing annotation source available after materialization", () => {
    stubResizeObserver();
    const frames = stubAnimationFrames();
    const messages: readonly SessionMessageInfo[] = [
      textAssistantMessage("old", "An older passage."),
      ...userMessages("m", 25),
    ];
    const source = {
      messageID: "old",
      block: '["content",0,"text"]',
      textDigest: "0".repeat(64),
      start: 0,
      end: 6,
    };
    let highlights!: ReturnType<typeof createAnnotationHighlights>;
    const { dispose } = mount(() => {
      highlights = createAnnotationHighlights({
        sources: () => [{ key: "annotation-1", source }],
        canSelect: () => false,
        onSelection: () => undefined,
        onOpen: () => undefined,
        onDismiss: () => undefined,
      });
      return (
        <TranscriptView
          sessionID="session"
          messages={messages}
          sessionStatus="idle"
          annotationRootRef={highlights.attach}
        />
      );
    });
    try {
      expect(highlights.findSource(source)).toBeUndefined();

      frames.runAll();

      const block = highlights.findSource(source);
      expect(block).toBeDefined();
      expect(block?.textContent).toContain("An older passage.");
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("shows raw tool input and structured errors for each tool status", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      {
        id: "assistant",
        time: base,
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [
          { type: "reasoning", text: "Working through it" },
          assistant("stream", "streaming"),
          assistant("run", "running"),
          assistant("done", "completed"),
          assistant("error", "error"),
          {
            type: "tool",
            id: "error-output",
            name: "check",
            time: base,
            state: {
              status: "error",
              input: { command: "check" },
              error: { type: "tool", message: "failed after output" },
              content: [{ type: "text", text: "Partial result" }],
            },
          },
        ],
      },
      {
        id: "compaction-running",
        time: base,
        type: "compaction",
        status: "running",
        reason: "auto",
        summary: "Running summary",
        recent: "Recent context",
      },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="running" />
    ));
    expect(
      [...host.querySelectorAll<HTMLButtonElement>(".transcript-tool-header")].map((button) =>
        button.getAttribute("aria-expanded"),
      ),
    ).toEqual(["false", "false", "false", "false", "false"]);
    expect(
      host
        .querySelector(".transcript-reasoning .transcript-context-trigger")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      host
        .querySelector(".transcript-compaction-running .transcript-context-trigger")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    host
      .querySelectorAll<HTMLButtonElement>(".transcript-tool-header, .transcript-context-trigger")
      .forEach((button) => button.click());
    expect(host.querySelector(".transcript-reasoning-summary")?.textContent).toBe(
      "Working through it",
    );
    expect(host.querySelector(".transcript-tool-streaming")).not.toBeNull();
    expect(host.querySelector(".transcript-tool-running")).not.toBeNull();
    expect(host.querySelector(".transcript-tool-completed")).not.toBeNull();
    expect(host.querySelector(".transcript-tool-error")).not.toBeNull();
    expect(host.textContent).toContain("raw input");
    expect(host.textContent).toContain('"command": "check"');
    expect(host.textContent).toContain("passed");
    expect(host.textContent).toContain("report.txt");
    expect(host.textContent).toContain("text/plain");
    expect(host.textContent).toContain("file:///tmp/report.txt");
    expect(host.textContent).toContain("failed");
    expect(host.textContent).toContain("Partial result");
    expect(host.textContent).toContain("Error");
    expect(
      [...host.querySelectorAll<HTMLElement>(".transcript-tool-output")].map((element) =>
        element.getAttribute("data-annotation-block"),
      ),
    ).toEqual([
      null,
      '["tool","run","input"]',
      '["tool","done","input"]',
      '["tool","done","output",0,"text"]',
      '["tool","error","input"]',
      '["tool","error-output","input"]',
      '["tool","error-output","output",0,"text"]',
    ]);
    dispose();
    vi.unstubAllGlobals();
  });

  it("renders model text as sanitized Markdown", () => {
    stubResizeObserver();
    const messages: readonly SessionMessageInfo[] = [
      {
        id: "assistant-markdown",
        time: { ...base, completed: 2 },
        type: "assistant",
        agent: "build",
        model: { providerID: "p", id: "m" },
        content: [
          {
            type: "text",
            text: [
              "## Result",
              "",
              "This is **important** with `inline code`.",
              "",
              "- First",
              "- Second",
              "",
              '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
              "<script>alert(1)</script>",
            ].join("\n"),
          },
        ],
      },
    ];
    const { host, dispose } = mount(() => (
      <TranscriptView sessionID="session" messages={messages} sessionStatus="idle" />
    ));

    const markdown = host.querySelector<HTMLElement>(".transcript-markdown");
    expect(markdown?.querySelector("h2")?.textContent).toBe("Result");
    expect(markdown?.querySelector("strong")?.textContent).toBe("important");
    expect(markdown?.querySelector("code")?.textContent).toBe("inline code");
    expect(markdown?.querySelectorAll("li")).toHaveLength(2);
    expect(markdown?.querySelector("script")).toBeNull();
    expect(markdown?.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(markdown?.querySelector("a")?.hasAttribute("onclick")).toBe(false);

    dispose();
    vi.unstubAllGlobals();
  });

  it("scrolls to the bottom the first time a delayed transcript opens", async () => {
    vi.useFakeTimers();
    let notifyResize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private target: Element | undefined;

        constructor(callback: ResizeObserverCallback) {
          notifyResize = () => {
            if (this.target === undefined) throw new Error("No resize target was observed");
            const entry: ResizeObserverEntry = {
              target: this.target,
              contentRect: new DOMRectReadOnly(0, 0, 0, 480),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            };
            callback([entry], this);
          };
        }
        observe(target: Element) {
          this.target = target;
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const [loading, setLoading] = createSignal(true);
    const [messages, setMessages] = createSignal<readonly SessionMessageInfo[]>([]);
    const { host, dispose } = mount(() => (
      <TranscriptView
        sessionID="first"
        messages={messages()}
        sessionStatus="idle"
        loading={loading()}
      />
    ));
    const transcript = host.querySelector<HTMLElement>(".transcript-view")!;
    let scrollHeight = 0;
    Object.defineProperty(transcript, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });

    transcript.scrollTop = 10;
    vi.advanceTimersByTime(301);
    batch(() => {
      setMessages([{ id: "message", time: base, type: "user", text: "Prompt" }]);
      setLoading(false);
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    scrollHeight = 480;
    notifyResize?.();
    expect(transcript.scrollTop).toBe(480);

    dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders a valid sent review collapsed and reveals its immutable snapshot", () => {
    const prompt = createSessionPrompt({
      instruction: "Please fix this carefully.",
      annotations: [],
      reviewComments: [
        {
          path: "src/example.ts",
          body: "Keep this branch safe.",
          selection: { start: 4, side: "deletions", end: 5, endSide: "additions" },
          selectedCode: "const oldValue = 1;\nconst newValue = 2;",
        },
      ],
    });
    const message: SessionMessageUser = {
      id: "review",
      time: base,
      type: "user",
      text: prompt.text,
      metadata: prompt.metadata,
    };
    const { host, dispose } = renderUserMessage(message);

    const card = host.querySelector<HTMLElement>(".transcript-code-review-card")!;
    const trigger = card.querySelector<HTMLButtonElement>(".transcript-code-review-trigger")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("Please fix this carefully.");
    expect(host.textContent).toContain("Code review · 1 comment");
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".transcript-code-review-content")).not.toBeNull();
    expect(host.textContent).toContain("src/example.ts");
    expect(host.textContent).toContain("old 4 to new 5");
    expect(host.textContent).toContain("const oldValue = 1;");
    expect(host.textContent).toContain("Keep this branch safe.");

    dispose();
  });

  it("renders named and unnamed image attachments as enlargeable thumbnails", () => {
    const message: SessionMessageUser = {
      id: "attachments",
      time: base,
      type: "user",
      text: "",
      files: [
        { data: "AAAA", mime: "image/png", source: { type: "inline" }, name: "preview.png" },
        { data: "BBBB", mime: "image/png", source: { type: "inline" } },
        { data: "bW90ZXM=", mime: "text/plain", source: { type: "inline" }, name: "notes.txt" },
        { data: "bW9yZQ==", mime: "text/plain", source: { type: "inline" } },
      ],
    };
    const { host, dispose } = renderUserMessage(message);

    const labels = [...host.querySelectorAll(".transcript-user-image")].map((thumbnail) =>
      thumbnail.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Enlarge preview.png", "Enlarge Attached image"]);
    expect(host.textContent).toContain("notes.txt");
    expect(host.textContent).toContain("Attached file");
    expect(host.textContent).not.toContain("preview.png");

    dispose();
  });

  it("reacts when durable review metadata arrives on an SDK store proxy", () => {
    const prompt = createSessionPrompt({
      instruction: "",
      annotations: [],
      reviewComments: [
        {
          path: "src/example.ts",
          body: "Use the durable metadata.",
          selection: { start: 2, end: 3 },
          selectedCode: "first();\nsecond();",
        },
      ],
    });
    const [state, setState] = createStore<{ readonly message: SessionMessageUser }>({
      message: {
        id: "review",
        time: base,
        type: "user",
        text: prompt.text,
      },
    });
    const { host, dispose } = renderUserMessage(state.message);

    expect(host.textContent).toContain("Please fix all code review comments below.");
    expect(host.querySelector(".transcript-code-review-card")).toBeNull();

    setState("message", "metadata", prompt.metadata);

    expect(host.textContent).not.toContain("Please fix all code review comments below.");
    expect(host.textContent).toContain("Code review · 1 comment");

    dispose();
  });

  it("renders an instruction-empty review without the model Markdown", () => {
    const prompt = createSessionPrompt({
      instruction: " \n\t",
      annotations: [],
      reviewComments: [
        {
          path: "empty.ts",
          body: "Use the existing helper.",
          selection: { start: 1, end: 1 },
          selectedCode: "helper();",
        },
      ],
    });
    const { host, dispose } = renderUserMessage({
      id: "empty-review",
      time: base,
      type: "user",
      text: prompt.text,
      metadata: prompt.metadata,
    });

    expect(host.textContent).toContain("Code review · 1 comment");
    expect(host.textContent).not.toContain("Please fix all code review comments below.");
    expect(host.textContent).not.toContain(" \n\t");
    dispose();
  });

  it("renders annotation-only messages as a separate collapsed card and opens their quote", () => {
    const onOpen = vi.fn<(messageID: string, annotationID: string, opener: HTMLElement) => void>();
    const prompt = createSessionPrompt({
      instruction: "",
      reviewComments: [],
      annotations: [
        {
          id: "annotation-1",
          source: {
            messageID: "source-1",
            block: "body",
            textDigest: "a".repeat(64),
            start: 0,
            end: 6,
          },
          quote: "Source",
          body: "Please explain this.",
        },
      ],
    });
    const { host, dispose } = mount(() => (
      <UserMessage
        message={{ id: "sent-1", type: "user", time: base, ...prompt }}
        onOpenAnnotation={onOpen}
      />
    ));
    const card = host.querySelector<HTMLElement>(".transcript-annotation-card")!;
    const trigger = card.querySelector<HTMLButtonElement>(".transcript-annotation-trigger")!;
    expect(host.querySelector(".transcript-user-bubble")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Please explain this.");
    trigger.click();
    expect(host.textContent).toContain("Please explain this.");
    expect(card.querySelector(".transcript-annotation-content")).not.toBeNull();
    const quote = card.querySelector<HTMLButtonElement>(".transcript-annotation-quote")!;
    quote.click();
    expect(onOpen).toHaveBeenCalledWith("sent-1", "annotation-1", quote);
    expect(host.textContent.indexOf("Please explain this.")).toBeLessThan(
      host.textContent.indexOf("Source"),
    );
    dispose();
  });

  it("falls back to exact user text when review metadata is malformed", () => {
    const text = " \n Original prompt with malformed metadata\t ";
    const { host, dispose } = renderUserMessage({
      id: "malformed-review",
      time: base,
      type: "user",
      text,
      metadata: { [CODE_REVIEW_METADATA_KEY]: { kind: "code-review", version: 2 } },
    });

    expect(host.querySelector(".transcript-user-bubble")?.textContent).toBe(text);
    expect(host.querySelector(".transcript-code-review-card")).toBeNull();
    dispose();
  });
});
