import type { PromptSkillAttachment } from "@opencode/client";
import { Slice, type Fragment, type Node, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import {
  parseDraft,
  schema,
  serializeDraft,
  serializeSlice as serializeSliceContent,
} from "./markdown.ts";

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
 * The Markdown paste policy: a code block takes the text literally, while
 * anywhere else it is parsed as draft Markdown.
 */
export function pasteContent(state: EditorState, text: string): Transaction {
  const { from, to } = state.selection;
  if (state.selection.$from.parent.type.spec.code) {
    return state.tr.insertText(text, from, to);
  }
  return state.tr.replaceSelection(Slice.maxOpen(fromDraft(text).content));
}

/**
 * Builds a document for literal text: characters are never reinterpreted as
 * Markdown or HTML. A single newline becomes the composer's hard break and a
 * blank line starts a new paragraph, matching the shape a Markdown parse gives
 * the same text. Carriage returns normalize to line feeds; whitespace inside a
 * line, including trailing spaces, stays exactly as pasted.
 */
export function fromPlainText(text: string): PMNode {
  const blocks: PMNode[] = [];
  let inline: PMNode[] = [];
  const flush = () => {
    blocks.push(schema.node("paragraph", null, inline.length > 0 ? inline : undefined));
    inline = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      // Runs of blank lines separate paragraphs without creating empty ones.
      if (inline.length > 0) flush();
      continue;
    }
    if (inline.length > 0) inline.push(schema.node("hard_break"));
    inline.push(schema.text(line));
  }
  if (inline.length > 0) flush();
  // An all-blank payload has no insertion of its own; the router treats it as
  // a no-op instead of replacing the selection.
  return schema.node("doc", null, blocks);
}

/**
 * The literal paste policy: insert the characters as typed, without Markdown
 * or HTML interpretation. A code block takes the raw text so its newlines stay
 * newlines; anywhere else newlines become hard breaks.
 */
export function pastePlainText(state: EditorState, text: string): Transaction {
  const { from, to } = state.selection;
  if (state.selection.$from.parent.type.spec.code) {
    return state.tr.insertText(text, from, to);
  }
  return state.tr.replaceSelection(Slice.maxOpen(fromPlainText(text).content));
}

/**
 * Whether a parsed slice carries content worth inserting. Empty paragraphs and
 * whitespace are not content: inserting them would replace the selection with
 * nothing, which is how a failed HTML parse used to delete selected text.
 */
export function sliceHasInsertableContent(slice: Slice): boolean {
  if (slice.content.size === 0) return false;
  let insertable = false;
  slice.content.descendants((node) => {
    if (insertable) return false;
    if (node.isText ? (node.text ?? "").trim() !== "" : node.isLeaf) insertable = true;
    return !insertable;
  });
  return insertable;
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
