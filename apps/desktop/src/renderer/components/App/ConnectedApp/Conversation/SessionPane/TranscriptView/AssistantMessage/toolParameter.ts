import type { JsonValue, SessionMessageAssistantTool } from "@opencode/client";
import { Predicate } from "effect";

import { serverPathRelative } from "../../../../../../../ui/serverPath.ts";

/**
 * Hard bound on the text handed to a row's DOM and accessible name. It is not a
 * display rule: the row's width decides what is visible. A longer value keeps
 * both of its ends, so the row still shows what an unbounded value would.
 */
export const TOOL_PARAMETER_TEXT_BOUND = 512;

/** One-line parameter summary for a tool header. */
export type ToolParameter = {
  readonly text: string;
  /** A filesystem path, whose file name identifies the row. */
  readonly path: boolean;
};

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
 * Parameter summary for a tool header. Returns undefined until the SDK hands
 * over a parsed input object; streamed JSON text is never inspected. A path
 * input inside `directory` is shown relative to it.
 */
export function toolParameter(
  tool: Pick<SessionMessageAssistantTool, "name" | "state">,
  directory?: string,
): ToolParameter | undefined {
  if (tool.state.status === "streaming") return undefined;
  const parameter = inputParameter(tool.name, tool.state.input, directory);
  if (parameter === undefined) return undefined;
  const text = oneLine(parameter.text);
  return text === undefined ? undefined : { text, path: parameter.path };
}

function inputParameter(
  name: string,
  input: ToolInput,
  directory?: string,
): ToolParameter | undefined {
  for (const key of PRIMARY_KEYS.get(name) ?? []) {
    const value = input[key];
    if (!isText(value)) continue;
    const rebased =
      key === "path" && directory !== undefined ? serverPathRelative(directory, value) : value;
    const text = displayText(name, rebased);
    if (text === undefined) return undefined;
    // A patch header carries a path too, so it keeps the same tail.
    return { text, path: key === "path" || name === "patch" };
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

/**
 * Collapses whitespace so the value stays one line, then bounds its length. The
 * bound keeps both ends, so a value over it still shows what the row would show
 * unbounded: the head of a command, the tail of a path.
 */
function oneLine(value: string): string | undefined {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= TOOL_PARAMETER_TEXT_BOUND) return collapsed;
  const half = Math.floor(TOOL_PARAMETER_TEXT_BOUND / 2);
  // Keep the code-unit ceiling without cutting a surrogate pair in half: both
  // cuts take the pair whole rather than dropping it.
  const head = collapsed.slice(0, half + (leadsSurrogatePair(collapsed, half - 1) ? 1 : 0));
  const start = collapsed.length - half;
  return `${head}…${collapsed.slice(start - (trailsSurrogatePair(collapsed, start) ? 1 : 0))}`;
}

/** True when `index` holds the leading half of a surrogate pair. */
function leadsSurrogatePair(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** True when `index` holds the trailing half of a surrogate pair. */
function trailsSurrogatePair(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 0xdc00 && unit <= 0xdfff;
}
