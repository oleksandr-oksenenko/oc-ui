import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { TranscriptView } from "./TranscriptView.tsx";

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

describe("TranscriptView", () => {
  it("renders every SDK message variant and preserves assistant source order", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <TranscriptView messages={messages} sessionStatus="idle" />, host);

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
    expect(host.textContent).toContain("Compaction completed");
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
    expect(
      host
        .querySelector('[data-message-id="assistant"] .transcript-reasoning-toggle')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
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
    expect(
      host.querySelector('.transcript-reasoning [data-slot="collapsible-arrow-icon"]'),
    ).not.toBeNull();
    dispose();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows raw tool input and structured errors for each tool status", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => <TranscriptView messages={messages} sessionStatus="running" />,
      host,
    );
    expect(
      [...host.querySelectorAll<HTMLButtonElement>(".transcript-tool-header")].map((button) =>
        button.getAttribute("aria-expanded"),
      ),
    ).toEqual(["false", "false", "false", "false"]);
    expect(host.querySelector(".transcript-reasoning-toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      host
        .querySelector(".transcript-compaction-running .transcript-context-trigger")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    host
      .querySelectorAll<HTMLButtonElement>(
        ".transcript-tool-header, .transcript-reasoning-toggle, .transcript-context-trigger",
      )
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
    expect(host.textContent).toContain("Error");
    dispose();
    host.remove();
    vi.unstubAllGlobals();
  });
});
