import {
  baseKeymap,
  chainCommands,
  exitCode,
  liftEmptyBlock,
  newlineInCode,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import type { Command, EditorState, Plugin } from "prosemirror-state";

import { schema } from "./markdown.ts";

const listItemType = schema.nodes.list_item!;
const bulletListType = schema.nodes.bullet_list!;
const orderedListType = schema.nodes.ordered_list!;
const blockquoteType = schema.nodes.blockquote!;
const headingType = schema.nodes.heading!;
const paragraphType = schema.nodes.paragraph!;
const codeBlockType = schema.nodes.code_block!;
const hardBreakType = schema.nodes.hard_break!;
const strongMark = schema.marks.strong!;
const emMark = schema.marks.em!;
const codeMark = schema.marks.code!;
const linkMark = schema.marks.link!;

/**
 * Applies `mark` to the text between typed delimiters. The delimiters are
 * removed while the wrapped text keeps its content and any existing marks, so
 * a rule never replaces an atom or drops formatting that is already active.
 * Rules never fire inside inline code.
 */
function markInputRule(regexp: RegExp, mark: MarkType): InputRule {
  return new InputRule(
    regexp,
    (state, match, start, end) => {
      const content = match[1];
      if (!content || insideCodeContext(state, start)) return null;
      const offset = match[0].indexOf(content);
      const opening = start + offset;
      return state.tr
        .delete(opening + content.length, end)
        .delete(start, opening)
        .addMark(start, start + content.length, mark.create())
        .removeStoredMark(mark);
    },
    { inCodeMark: false },
  );
}

/**
 * A code context is an active code mark (including one toggled on for typed
 * text) or text after an unclosed code-span run. Code spans close only on a
 * run of the same length, so unmatched run lengths stay open.
 */
function insideCodeContext(state: EditorState, position: number): boolean {
  const marks = state.storedMarks ?? state.selection.$from.marks();
  if (marks.some((mark) => mark.type.spec.code)) return true;
  const $position = state.doc.resolve(position);
  const before = $position.parent.textBetween(0, $position.parentOffset, null, "\ufffc");
  const open: number[] = [];
  for (const run of before.matchAll(/`+/g)) {
    const match = open.lastIndexOf(run[0].length);
    if (match >= 0) open.splice(match, 1);
    else open.push(run[0].length);
  }
  return open.length > 0;
}

/**
 * The composer's new-line gesture: a line break inside the current block.
 * On an empty line it starts a new paragraph instead, so a list, quote or
 * heading can begin after earlier lines while plain lines stay tight in the
 * draft text. A heading is one line in Markdown, so it always yields.
 */
const insertLineBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  if ($from.parent.type.name === "heading") return splitBlock(state, dispatch);
  if ($from.nodeBefore?.type === hardBreakType && $from.parent.content.size > 0) {
    return splitBlock(state, dispatch);
  }
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreakType.create()).scrollIntoView());
  }
  return true;
};

/** Markdown shortcuts that apply as the user types. */
function promptInputRules(): readonly InputRule[] {
  return [
    wrappingInputRule(/^>\s$/, blockquoteType),
    // Editor-created lists are tight; the bundled parser keeps the tightness
    // of parsed lists.
    wrappingInputRule(/^([-+*])\s$/, bulletListType, () => ({ tight: true })),
    wrappingInputRule(
      /^(\d+)[.)]\s$/,
      orderedListType,
      (match) => ({ order: Number(match[1]), tight: true }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1]),
    ),
    textblockTypeInputRule(/^(#{1,6})\s$/, headingType, (match) => ({
      level: match[1]!.length,
    })),
    textblockTypeInputRule(/^(`{3,}|~{3,})[ \t]*([\w-]*)\s$/, codeBlockType, (match) => ({
      params: match[2] ?? "",
    })),
    markInputRule(/(?<![\\*_])\*{2}([^*_\\\s](?:[^*_\\]*[^*_\\\s])?)\*{2}$/, strongMark),
    markInputRule(/(?<![\w*_\\])_{2}([^*_\\\s](?:[^*_\\]*[^*_\\\s])?)_{2}$/, strongMark),
    markInputRule(/(?<![\\*_])\*([^*_\\\s](?:[^*_\\]*[^*_\\\s])?)\*$/, emMark),
    markInputRule(/(?<![\w*_\\])_([^*_\\\s](?:[^*_\\]*[^*_\\\s])?)_$/, emMark),
    markInputRule(/`([^`]+)`$/, codeMark),
    new InputRule(
      /(?<!!)\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)$/,
      (state, match, start, end) => {
        const text = match[1]!;
        const href = match[2] ?? "";
        if (insideCodeContext(state, start)) return null;
        const offset = match[0].indexOf(text);
        const opening = start + offset;
        return state.tr
          .delete(opening + text.length, end)
          .delete(start, opening)
          .addMark(start, start + text.length, linkMark.create({ href }))
          .removeStoredMark(linkMark);
      },
      { inCodeMark: false },
    ),
  ];
}

/**
 * Editing behavior for the composer. Enter stays with the composer's submit
 * contract, so Shift+Enter is the new-line gesture: it continues lists and
 * code blocks, breaks a line inside a block, and starts a new paragraph when
 * the line is already empty.
 */
export function promptPlugins(): Plugin[] {
  return [
    history(),
    keymap({
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      Backspace: undoInputRule,
      "Mod-b": toggleMark(strongMark),
      "Mod-i": toggleMark(emMark),
      "Mod-e": toggleMark(codeMark),
      "Mod-Shift-7": wrapInList(orderedListType, { tight: true }),
      "Mod-Shift-8": wrapInList(bulletListType, { tight: true }),
      "Mod-Shift-9": wrapIn(blockquoteType),
      "Mod-Alt-0": setBlockType(paragraphType),
      "Mod-Alt-1": setBlockType(headingType, { level: 1 }),
      "Mod-Alt-2": setBlockType(headingType, { level: 2 }),
      "Mod-Alt-3": setBlockType(headingType, { level: 3 }),
      "Shift-Enter": chainCommands(
        newlineInCode,
        splitListItem(listItemType),
        liftEmptyBlock,
        insertLineBreak,
      ),
      "Shift-Mod-Enter": exitCode,
      Tab: sinkListItem(listItemType),
      "Shift-Tab": liftListItem(listItemType),
    }),
    keymap(baseKeymap),
    inputRules({ rules: promptInputRules() }),
  ];
}
