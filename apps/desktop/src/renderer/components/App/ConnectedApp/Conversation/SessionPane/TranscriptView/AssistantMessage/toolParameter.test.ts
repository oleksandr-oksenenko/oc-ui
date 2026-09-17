import type { JsonValue, SessionMessageAssistantTool } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { toolParameter, TOOL_PARAMETER_LIMIT } from "./toolParameter.ts";

function running(name: string, input: Record<string, JsonValue>): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool",
    name,
    time: { created: 1, ran: 2 },
    state: { status: "running", input, metadata: {} },
  };
}

function streaming(name: string, input: string): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool",
    name,
    time: { created: 1 },
    state: { status: "streaming", input },
  };
}

function completed(name: string, input: Record<string, JsonValue>): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool",
    name,
    time: { created: 1, ran: 2, completed: 3 },
    state: { status: "completed", input, content: [{ type: "text", text: "done" }] },
  };
}

function failed(name: string, input: Record<string, JsonValue>): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool",
    name,
    time: { created: 1, ran: 2, completed: 3 },
    state: { status: "error", input, error: { type: "tool", message: "failed" } },
  };
}

describe("toolParameter", () => {
  it("shows the primary path for file tools", () => {
    expect(toolParameter(running("read", { path: "src/index.ts", offset: 10 }))).toBe(
      "src/index.ts",
    );
    expect(
      toolParameter(completed("edit", { path: "src/app.ts", oldString: "a", newString: "b" })),
    ).toBe("src/app.ts");
    expect(toolParameter(running("write", { path: "notes.md", content: "text" }))).toBe("notes.md");
  });

  it("shows the query for search tools", () => {
    expect(toolParameter(running("grep", { pattern: "unused", include: "*.ts" }))).toBe("unused");
    expect(toolParameter(running("glob", { pattern: "**/*.tsx" }))).toBe("**/*.tsx");
    expect(toolParameter(running("websearch", { query: "tool call headers" }))).toBe(
      "tool call headers",
    );
    expect(toolParameter(running("webfetch", { url: "https://example.com" }))).toBe(
      "https://example.com",
    );
  });

  it("shows the skill id and command-like inputs", () => {
    expect(toolParameter(running("skill", { id: "release-checklist" }))).toBe("release-checklist");
    expect(toolParameter(running("shell", { command: "pnpm test", timeout: 1000 }))).toBe(
      "pnpm test",
    );
    expect(toolParameter(running("bash", { command: "git status" }))).toBe("git status");
  });

  it("prefers the subagent description over its first input", () => {
    expect(
      toolParameter(
        running("subagent", {
          agent: "explore",
          description: "Find tool renderers",
          prompt: "Locate the tool header",
        }),
      ),
    ).toBe("Find tool renderers");
  });

  it("extracts the first file from patch text", () => {
    expect(
      toolParameter(
        completed("patch", {
          patchText: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch",
        }),
      ),
    ).toBe("src/app.ts");
  });

  it("shows nothing for a patch without a file marker", () => {
    expect(
      toolParameter(completed("patch", { patchText: "*** Begin Patch\n*** End Patch" })),
    ).toBeUndefined();
  });

  it("shows nothing for tools without a mapped primary key", () => {
    expect(toolParameter(running("mcp__search", { query: "tool calls" }))).toBeUndefined();
    expect(
      toolParameter(running("apply_patch", { path: "src/renderer/styles.css" })),
    ).toBeUndefined();
    expect(toolParameter(running("browser_capture", { tab: "preview" }))).toBeUndefined();
    expect(toolParameter(running("inspect", {}))).toBeUndefined();
    expect(toolParameter(running("grep", { include: "*.ts" }))).toBeUndefined();
  });

  it("keeps streamed parameters on one line", () => {
    expect(toolParameter(running("shell", { command: "pnpm test\necho done" }))).toBe(
      "pnpm test echo done",
    );
  });

  it("truncates long values within the limit", () => {
    const value = `src/${"nested-directory/".repeat(20)}index.ts`;
    const parameter = toolParameter(running("read", { path: value }))!;
    expect(parameter.length).toBeLessThanOrEqual(TOOL_PARAMETER_LIMIT);
    expect(parameter.endsWith("…")).toBe(true);
    expect(parameter).not.toContain("\n");
  });

  it("keeps exact-limit values untouched and clips one over", () => {
    const exact = "a".repeat(TOOL_PARAMETER_LIMIT);
    expect(toolParameter(running("read", { path: exact }))).toBe(exact);
    const over = "a".repeat(TOOL_PARAMETER_LIMIT + 1);
    expect(toolParameter(running("read", { path: over }))).toBe(
      `${"a".repeat(TOOL_PARAMETER_LIMIT - 1)}…`,
    );
  });

  it("shows nothing for empty or non-string primary values", () => {
    expect(toolParameter(running("read", { path: "   " }))).toBeUndefined();
    expect(toolParameter(running("read", { path: null }))).toBeUndefined();
    expect(toolParameter(running("read", { path: 3 }))).toBeUndefined();
    expect(toolParameter(running("read", { path: false }))).toBeUndefined();
    expect(toolParameter(running("read", { path: ["src/app.ts"] }))).toBeUndefined();
  });

  it("shows the parameter for error states", () => {
    expect(toolParameter(failed("read", { path: "src/app.ts" }))).toBe("src/app.ts");
  });

  it("waits for parsed input instead of reading streamed JSON text", () => {
    // Even complete JSON is not trusted while the state still says streaming;
    // the parameter appears once the SDK reports a parsed input object.
    expect(toolParameter(streaming("read", '{"path":"src/index.ts","offset":1}'))).toBeUndefined();
    expect(toolParameter(streaming("read", '{"path":"src/renderer/'))).toBeUndefined();
    expect(toolParameter(streaming("read", "raw input"))).toBeUndefined();
  });

  it("does not split a surrogate pair when truncating", () => {
    expect(toolParameter(running("read", { path: `${"a".repeat(62)}😀tail` }))).toBe(
      `${"a".repeat(62)}…`,
    );
  });
});
