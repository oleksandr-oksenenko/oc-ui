import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode-ai/client";
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { stubResizeObserver } from "../../../../../test/resize-observer.ts";
import { TranscriptView } from "./TranscriptView.tsx";
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
    expect(host.querySelector(".transcript-reasoning-summary")?.textContent).toBe("Think");
    expect(host.querySelector(".transcript-reasoning button")).toBeNull();
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-slot="collapsible-trigger"]')].every(
        (trigger) => trigger.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
    expect(
      [
        ...host.querySelectorAll<HTMLElement>(
          ".transcript-tool-call, .transcript-shell-message, .transcript-skill-message, .transcript-compaction, .transcript-context-message",
        ),
      ].every((element) => element.dataset.component === "collapsible"),
    ).toBe(true);
    expect(host.querySelector(".transcript-reasoning svg")).not.toBeNull();
    dispose();
    vi.unstubAllGlobals();
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
    expect(host.querySelector(".transcript-reasoning-summary")?.textContent).toBe(
      "Working through it",
    );
    expect(
      host
        .querySelector(".transcript-compaction-running .transcript-context-trigger")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    host
      .querySelectorAll<HTMLButtonElement>(".transcript-tool-header, .transcript-context-trigger")
      .forEach((button) => button.click());
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
    expect(host.textContent).toContain("src/example.ts");
    expect(host.textContent).toContain("old 4 to new 5");
    expect(host.textContent).toContain("const oldValue = 1;");
    expect(host.textContent).toContain("Keep this branch safe.");

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
