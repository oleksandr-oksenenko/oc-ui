import type { PromptSkillAttachment } from "@opencode/client";
import { Slice, type Fragment, type Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

import { parseDraft, serializeDraft, serializeSlice as serializeSliceContent } from "./markdown.ts";

export { schema } from "./markdown.ts";

/**
 * Rebuilds a document from draft text. Skill mentions that still match the
 * text become atoms; stale or overlapping mentions stay ordinary text.
 */
export function fromDraft(text: string, skills: readonly PromptSkillAttachment[] = []) {
  return parseDraft(text, skills);
}

export function toDraft(doc: Node) {
  return serializeDraft(doc);
}

/** Serializes clipboard slice content with skill atoms written as names. */
export function serializeSlice(content: Fragment): string {
  return serializeSliceContent(content);
}

/**
 * The plain-text paste policy: a code block takes the text literally, while
 * anywhere else it is parsed as draft Markdown.
 */
export function pasteContent(state: EditorState, text: string): Transaction {
  const { from, to } = state.selection;
  if (state.selection.$from.parent.type.spec.code) {
    return state.tr.insertText(text, from, to);
  }
  return state.tr.replaceSelection(Slice.maxOpen(fromDraft(text).content));
}

export function slashQuery(
  state: EditorState,
): { text: string; from: number; to: number } | undefined {
  const { $from, empty } = state.selection;
  // Code blocks take text literally, so suggestions and skill atoms have no
  // meaning there.
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc");
  // Names may contain slashes (nested command directories); the whitespace or
  // start guard still keeps path text like `src/review` out of the menu.
  const match = /(?:^|\s)\/([^\s]*)$/.exec(before);
  return match
    ? { text: match[1]!, from: $from.pos - match[1]!.length - 1, to: $from.pos }
    : undefined;
}
