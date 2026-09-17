import type { JsonValue, SessionMessageAssistantTool } from "@opencode/client";
import { Predicate } from "effect";

/** Longest parameter summary shown beside a tool name; longer values are truncated. */
export const TOOL_PARAMETER_LIMIT = 64;

/**
 * Primary input per tool, in priority order. Tools missing from this map show
 * no parameter until they are added here.
 */
const PRIMARY_KEYS = new Map([
  ["bash", ["command"]],
  ["edit", ["path"]],
  ["glob", ["pattern"]],
  ["grep", ["pattern"]],
  ["patch", ["patchText"]],
  ["read", ["path"]],
  ["shell", ["command"]],
  ["skill", ["id"]],
  ["subagent", ["description"]],
  ["webfetch", ["url"]],
  ["websearch", ["query"]],
  ["write", ["path"]],
]);

type ToolInput = { readonly [key: string]: JsonValue };

/**
 * One-line parameter summary for a tool header. Returns undefined until the
 * SDK hands over a parsed input object; streamed JSON text is never inspected.
 */
export function toolParameter(
  tool: Pick<SessionMessageAssistantTool, "name" | "state">,
): string | undefined {
  if (tool.state.status === "streaming") return undefined;
  const value = inputParameter(tool.name, tool.state.input);
  return value === undefined ? undefined : singleLine(value);
}

function inputParameter(name: string, input: ToolInput): string | undefined {
  for (const key of PRIMARY_KEYS.get(name) ?? []) {
    const value = input[key];
    if (isText(value)) return displayText(name, value);
  }
  return undefined;
}

/** Patch text carries whole files; the header shows the first target or nothing. */
function displayText(name: string, value: string): string | undefined {
  if (name !== "patch") return value;
  return /\*\*\* (?:Add|Update|Delete) File: (.+)/.exec(value)?.[1];
}

function isText(value: JsonValue | undefined): value is string {
  return Predicate.isString(value) && value.trim().length > 0;
}

/** Collapses whitespace and clips long values so the header stays one line. */
function singleLine(value: string): string | undefined {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= TOOL_PARAMETER_LIMIT) return collapsed;
  const clipped = collapsed.slice(0, TOOL_PARAMETER_LIMIT - 1);
  // Keep the code-unit ceiling without cutting a surrogate pair in half.
  const last = clipped.charCodeAt(clipped.length - 1);
  const safe = last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
  return `${safe.replace(/\s+$/, "")}…`;
}
