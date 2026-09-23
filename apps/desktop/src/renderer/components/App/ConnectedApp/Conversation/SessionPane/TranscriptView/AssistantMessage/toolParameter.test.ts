import type { JsonValue, SessionMessageAssistantTool } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { toolParameter, TOOL_PARAMETER_TEXT_BOUND } from "./toolParameter.ts";

/** A parameter whose row keeps its file name visible. */
const asPath = (text: string) => ({ text, path: true });

/** A parameter that is not a path. */
const asText = (text: string) => ({ text, path: false });

/** True when `text` holds a surrogate half without its partner. */
function loneSurrogate(text: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

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
    expect(toolParameter(running("read", { path: "src/index.ts", offset: 10 }))).toEqual(
      asPath("src/index.ts"),
    );
    expect(
      toolParameter(completed("edit", { path: "src/app.ts", oldString: "a", newString: "b" })),
    ).toEqual(asPath("src/app.ts"));
    expect(toolParameter(running("write", { path: "notes.md", content: "text" }))).toEqual(
      asPath("notes.md"),
    );
  });

  it("shows file tool paths relative to the session directory", () => {
    const directory = "/srv/worktrees/misty-rocket";
    expect(
      toolParameter(running("read", { path: `${directory}/src/index.ts` }), directory),
    ).toEqual(asPath("src/index.ts"));
    expect(
      toolParameter(completed("edit", { path: `${directory}/src/app.ts` }), directory),
    ).toEqual(asPath("src/app.ts"));
    expect(toolParameter(running("write", { path: `${directory}/notes.md` }), directory)).toEqual(
      asPath("notes.md"),
    );
    expect(toolParameter(running("read", { path: `${directory}/src/index.ts` }))).toEqual(
      asPath(`${directory}/src/index.ts`),
    );
  });

  it("keeps paths outside the session directory absolute", () => {
    const directory = "/srv/worktrees/misty-rocket";
    expect(
      toolParameter(running("read", { path: "/srv/projects/other/index.ts" }), directory),
    ).toEqual(asPath("/srv/projects/other/index.ts"));
    expect(
      toolParameter(running("read", { path: `${directory}-archive/a.ts` }), directory),
    ).toEqual(asPath(`${directory}-archive/a.ts`));
    expect(toolParameter(running("read", { path: directory }), directory)).toEqual(
      asPath(directory),
    );
  });

  it("rebases Windows separators and leaves non-path inputs verbatim", () => {
    const directory = "C:\\Users\\alex\\worktree";
    expect(
      toolParameter(running("read", { path: `${directory}\\src\\app.ts` }), directory),
    ).toEqual(asPath("src\\app.ts"));
    expect(
      toolParameter(running("shell", { command: `cd ${directory} && pnpm test` }), directory),
    ).toEqual(asText(`cd ${directory} && pnpm test`));
    expect(toolParameter(running("grep", { pattern: `${directory}/src` }), directory)).toEqual(
      asText(`${directory}/src`),
    );
  });

  it("shows the query for search tools", () => {
    expect(toolParameter(running("grep", { pattern: "unused", include: "*.ts" }))).toEqual(
      asText("unused"),
    );
    expect(toolParameter(running("glob", { pattern: "**/*.tsx" }))).toEqual(asText("**/*.tsx"));
    expect(toolParameter(running("websearch", { query: "tool call headers" }))).toEqual(
      asText("tool call headers"),
    );
    expect(toolParameter(running("webfetch", { url: "https://example.com" }))).toEqual(
      asText("https://example.com"),
    );
  });

  it("shows the skill id and command-like inputs", () => {
    expect(toolParameter(running("skill", { id: "release-checklist" }))).toEqual(
      asText("release-checklist"),
    );
    expect(toolParameter(running("shell", { command: "pnpm test", timeout: 1000 }))).toEqual(
      asText("pnpm test"),
    );
    expect(toolParameter(running("bash", { command: "git status" }))).toEqual(asText("git status"));
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
    ).toEqual(asText("Find tool renderers"));
  });

  it("extracts the first file from patch text", () => {
    expect(
      toolParameter(
        completed("patch", {
          patchText: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch",
        }),
      ),
    ).toEqual(asPath("src/app.ts"));
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
    expect(toolParameter(running("shell", { command: "pnpm test\necho done" }))).toEqual(
      asText("pnpm test echo done"),
    );
  });

  it("returns a value wider than the row without shortening it", () => {
    const value = `src/${"nested-directory/".repeat(20)}index.ts`;
    expect(toolParameter(running("read", { path: value }))).toEqual(asPath(value));
  });

  it("hands over values up to the text bound unchanged", () => {
    const exact = "a".repeat(TOOL_PARAMETER_TEXT_BOUND);
    expect(toolParameter(running("read", { path: exact }))).toEqual(asPath(exact));
    const over = "a".repeat(TOOL_PARAMETER_TEXT_BOUND + 1);
    expect(toolParameter(running("read", { path: over }))!.text.length).toBeLessThanOrEqual(
      TOOL_PARAMETER_TEXT_BOUND,
    );
  });

  it("keeps both ends of a value over the text bound", () => {
    const head = "h".repeat(TOOL_PARAMETER_TEXT_BOUND);
    const tail = "t".repeat(TOOL_PARAMETER_TEXT_BOUND);
    const parameter = toolParameter(running("shell", { command: `${head}${tail}` }))!;
    // The row shows the head of a command and the tail of a path, so the bound
    // keeps both ends, far beyond what a row can show.
    expect(parameter.text.startsWith("h".repeat(200))).toBe(true);
    expect(parameter.text.endsWith("t".repeat(200))).toBe(true);
    expect(parameter.text).toContain("…");
    expect(parameter.text.length).toBeLessThanOrEqual(TOOL_PARAMETER_TEXT_BOUND);
  });

  it("stays within the text bound whatever the value's length or code units", () => {
    const pair = "😀";
    const cases = [
      "a".repeat(TOOL_PARAMETER_TEXT_BOUND),
      "a".repeat(TOOL_PARAMETER_TEXT_BOUND + 1),
      `${pair}${pair}${"a".repeat(TOOL_PARAMETER_TEXT_BOUND * 4)}`,
      "a".repeat(TOOL_PARAMETER_TEXT_BOUND * 100),
    ];
    for (const command of cases) {
      const parameter = toolParameter(running("shell", { command }))!;
      expect(parameter.text.length).toBeLessThanOrEqual(TOOL_PARAMETER_TEXT_BOUND);
      // No cut may leave half of a surrogate pair behind.
      expect(loneSurrogate(parameter.text)).toBe(false);
    }
  });

  it("shows nothing for empty or non-string primary values", () => {
    expect(toolParameter(running("read", { path: "   " }))).toBeUndefined();
    expect(toolParameter(running("read", { path: null }))).toBeUndefined();
    expect(toolParameter(running("read", { path: 3 }))).toBeUndefined();
    expect(toolParameter(running("read", { path: false }))).toBeUndefined();
    expect(toolParameter(running("read", { path: ["src/app.ts"] }))).toBeUndefined();
  });

  it("shows the parameter for error states", () => {
    expect(toolParameter(failed("read", { path: "src/app.ts" }))).toEqual(asPath("src/app.ts"));
  });

  it("waits for parsed input instead of reading streamed JSON text", () => {
    // Even complete JSON is not trusted while the state still says streaming;
    // the parameter appears once the SDK reports a parsed input object.
    expect(toolParameter(streaming("read", '{"path":"src/index.ts","offset":1}'))).toBeUndefined();
    expect(toolParameter(streaming("read", '{"path":"src/renderer/'))).toBeUndefined();
    expect(toolParameter(streaming("read", "raw input"))).toBeUndefined();
  });

  it("does not split a surrogate pair when bounding a long value", () => {
    const pair = "😀";
    // Each value places the pair where the bound cuts: the tail's cut keeps the
    // pair whole, since a path's row shows exactly that end, and the head's cut
    // drops it whole instead of leaving half of it behind.
    const kept = toolParameter(running("shell", { command: `${pair}${"b".repeat(254)}` }))!;
    expect(kept.text).toContain(pair);
    expect(loneSurrogate(kept.text)).toBe(false);

    const dropped = toolParameter(
      running("shell", { command: `${"a".repeat(254)}${pair}${"b".repeat(400)}` }),
    )!;
    expect(dropped.text).not.toContain(pair);
    expect(loneSurrogate(dropped.text)).toBe(false);
  });
});
