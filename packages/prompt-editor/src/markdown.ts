import type { PromptSkillAttachment } from "@opencode/client";
import MarkdownIt from "markdown-it";
import { Fragment, type Node as PMNode, Schema } from "prosemirror-model";
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
  schema as baseSchema,
  type MarkdownSerializerState,
} from "prosemirror-markdown";

import { decodeNumericEntities } from "./markdown-text.ts";

/**
 * Drafts are CommonMark: the same text the model receives. Parsing and
 * serialization are owned by `prosemirror-markdown` so the composer, the
 * transcript, and the model all read one dialect.
 *
 * Composer specifics:
 * - A single newline is a hard line break, matching the transcript's
 *   `breaks` rendering and the composer's Shift+Enter gesture.
 * - Raw HTML stays literal text; image syntax is ignored.
 * - Skill atoms are not expressible in Markdown, so mentions are swapped for
 *   a nonce placeholder before parsing and restored inside text nodes.
 */

type MarkdownSkill = {
  readonly id: string;
  readonly name: string;
};

/**
 * The composer's schema is the bundled `prosemirror-markdown` schema plus the
 * app's inline skill atom. Lists, headings, code blocks, images, links and
 * their attributes keep the bundled behavior, and the parser and serializer
 * below are built against this exact instance.
 */
export const schema: Schema = new Schema({
  nodes: baseSchema.spec.nodes.append({
    skill: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: true,
      attrs: { id: {}, name: {} },
      toDOM: (node) => [
        "span",
        { "data-skill-id": node.attrs.id, "data-skill-name": node.attrs.name },
        node.attrs.name,
      ],
      parseDOM: [
        {
          tag: "span[data-skill-id]",
          getAttrs: (el) => ({ id: el.dataset.skillId, name: el.dataset.skillName }),
        },
      ],
    },
  }),
  marks: baseSchema.spec.marks,
});

// The bundled defaults apply: images parse into image nodes, tables and
// autolinks keep the user's source, and strikethrough is not a composer mark.
const tokenizer = new MarkdownIt("commonmark", { html: false });

type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number];

const markTokens = new Set(["em_open", "strong_open", "link_open"]);

/**
 * markdown-it nests a level every time the same delimiter pair appears, but a
 * ProseMirror mark is a set: closing an inner `__b__` would remove the outer
 * bold from `**a __b__ c**`. Identical nested pairs are redundant, so they are
 * dropped before the parser maps tokens to marks.
 */
function collapseRedundantMarks(tokens: MarkdownToken[]): MarkdownToken[] {
  const collapsed = collapseFlatMarks(tokens);
  for (const token of collapsed) {
    if (token.children !== null) token.children = collapseRedundantMarks(token.children);
  }
  return collapsed;
}

function collapseFlatMarks(tokens: MarkdownToken[]): MarkdownToken[] {
  const opened: { readonly token: MarkdownToken; readonly index: number }[] = [];
  const stack: number[] = [];
  const redundant = new Set<number>();
  tokens.forEach((token, index) => {
    if (token.type.endsWith("_open")) {
      if (markTokens.has(token.type)) {
        const duplicate = opened.find(
          (entry) => entry.token.type === token.type && sameAttrs(entry.token, token),
        );
        if (duplicate) redundant.add(index);
        opened.push({ token, index });
      }
      stack.push(index);
      return;
    }
    if (!token.type.endsWith("_close")) return;
    const start = stack.pop();
    if (start === undefined) return;
    if (redundant.has(start)) redundant.add(index);
    const position = opened.findIndex((entry) => entry.index === start);
    if (position >= 0) opened.splice(position, 1);
  });
  return redundant.size === 0 ? tokens : tokens.filter((_, index) => !redundant.has(index));
}

function sameAttrs(left: MarkdownToken, right: MarkdownToken): boolean {
  return JSON.stringify(left.attrs ?? null) === JSON.stringify(right.attrs ?? null);
}

// SAFETY: MarkdownParser only calls `parse` on its tokenizer, and the instance
// returns the same token stream with redundant nested mark pairs collapsed.
const parseWithMarkdownIt = tokenizer.parse.bind(tokenizer);
tokenizer.parse = (...args: Parameters<typeof parseWithMarkdownIt>) =>
  collapseRedundantMarks(parseWithMarkdownIt(...args));

const markdownParser = new MarkdownParser(schema, tokenizer, {
  // Everything the bundled schema maps the same way is reused; the composer
  // only changes how a single newline is read.
  ...defaultMarkdownParser.tokens,
  // A single newline is a line break for the composer, exactly as the
  // transcript renders it.
  softbreak: { node: "hard_break" },
});

type SkillSerializer = (
  state: MarkdownSerializerState,
  node: PMNode,
  parent: PMNode,
  index: number,
) => void;

function createSerializer(skillSerializer: SkillSerializer): MarkdownSerializer {
  return new MarkdownSerializer(
    {
      // Everything the bundled schema writes the same way is reused; only the
      // composer's deltas are written here.
      ...defaultMarkdownSerializer.nodes,
      // The composer writes the canonical bullet.
      bullet_list(state, node) {
        state.renderList(node, "  ", () => "- ");
      },
      // A trailing break carries no text, so it is dropped rather than
      // swallowed by the paragraph separator, and a plain newline keeps the
      // draft's single-newline shape.
      hard_break(state, node, parent, index) {
        for (let next = index + 1; next < parent.childCount; next += 1) {
          if (parent.child(next).type === node.type) continue;
          state.write("\n");
          return;
        }
      },
      text(state, node, parent, index) {
        const value = node.text ?? "";
        const atLineStart = index === 0 || parent.child(index - 1).type.name === "hard_break";
        state.write(escapeLiteralSyntax(state.esc(value, atLineStart), atLineStart));
      },
      skill: skillSerializer,
    },
    {
      // The bundled em and strong writers have the same shape.
      ...defaultMarkdownSerializer.marks,
      // The bundled code span writer does not pad edge spaces.
      code: {
        open: (_state, _mark, parent, index) => codeSpanDelimiter(textOf(parent.child(index)), -1),
        close: (_state, _mark, parent, index) =>
          codeSpanDelimiter(textOf(parent.child(index - 1)), 1),
        escape: false,
      },
      // The bundled link writer uses the autolink form for plain URLs, which
      // fights the literal-text escaping; the explicit form round-trips the
      // href and title.
      link: {
        open: "[",
        close: (_state, mark) => {
          const title =
            mark.attrs.title == null ? "" : ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`;
          return `](${linkDestination(String(mark.attrs.href ?? ""))}${title})`;
        },
        mixable: true,
      },
    },
    {
      hardBreakNodeName: "hard_break",
      // `1)` starts a list too; escape it when it is literal paragraph text.
      escapeExtraCharacters: /(?<=^\s*\d+)\)/,
    },
  );
}

/** The delimiter pair for an inline code span, sized to its content. */
function codeSpanDelimiter(text: string, side: number): string {
  const longest = longestBackticks(text);
  const fence = "`".repeat(longest + 1);
  // A space at either edge, or a backtick anywhere, needs a padding space on
  // both edges: CommonMark strips one space from each edge of the span.
  const padding = (longest > 0 || text.startsWith(" ") || text.endsWith(" ")) && text.trim() !== "";
  if (!padding) return fence;
  return side < 0 ? fence + " " : " " + fence;
}

/** Line starts that would turn literal text into a setext heading. */
function escapeSetext(value: string, atLineStart: boolean): string {
  return atLineStart && /^=+\s*$/.test(value) ? "\\" + value : value;
}

const entitySyntax = /&(?=[a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)/g;

/**
 * Every literal `<` is escaped: it is simpler and safer than recognizing the
 * tag, comment, doctype and autolink openings separately.
 */
const tagSyntax = /</g;

/**
 * Literal text must not read as entity, HTML tag or autolink syntax after the
 * draft is parsed again by the composer or by the transcript renderer. The
 * setext guard runs after the standard escaping, which would otherwise escape
 * its backslash.
 */
function escapeLiteralSyntax(escaped: string, atLineStart: boolean): string {
  return escapeSetext(escaped, atLineStart).replace(entitySyntax, "\\&").replace(tagSyntax, "\\<");
}

/** A node's literal text, or the name written for a skill atom. */
function textOf(node: PMNode): string {
  return node.isText ? (node.text ?? "") : String(node.attrs.name ?? "");
}

/**
 * Writes a skill atom as an opaque replacement string. A code mark is written
 * here because the serializer only emits non-escaping marks around text nodes.
 */
function renderSkill(state: MarkdownSerializerState, node: PMNode, replacement: string): void {
  const name = String(node.attrs.name ?? "");
  const code = schema.marks.code!.isInSet(node.marks);
  state.write();
  if (code) state.text(codeSpanDelimiter(name, -1), false);
  state.text(replacement, false);
  if (code) state.text(codeSpanDelimiter(name, 1), false);
}

function linkDestination(href: string): string {
  if (/[\s<>]/.test(href)) return "<" + href.replace(/[<>]/g, "") + ">";
  return href.replace(/[()]/g, "\\$&");
}

function longestBackticks(value: string): number {
  let longest = 0;
  for (const run of value.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return longest;
}

export type PromptDraft = {
  readonly text: string;
  readonly skills: readonly PromptSkillAttachment[];
};

/**
 * Serializes a document into draft text and its skill mention offsets. Skills
 * are written as opaque placeholders and substituted afterwards, so a literal
 * placeholder cannot be mistaken for one.
 */
export function serializeDraft(doc: PMNode): PromptDraft {
  return serializeNode(doc);
}

function serializeNode(node: PMNode): PromptDraft {
  const content = node.type.name === "doc" ? mergeAdjacentLists(node) : node;
  const nonce = freshNonce(content.textContent);
  const slots: MarkdownSkill[] = [];
  const source = createSerializer((state, skill) => {
    slots.push({ id: String(skill.attrs.id ?? ""), name: String(skill.attrs.name ?? "") });
    renderSkill(state, skill, placeholder(nonce, slots.length - 1));
  }).serialize(content);
  return substitute(source, nonce, slots);
}

function substitute(source: string, nonce: string, slots: readonly MarkdownSkill[]): PromptDraft {
  const pattern = new RegExp(`${placeholderStart}${nonce}(\\d+)${placeholderStart}`, "g");
  let text = "";
  let cursor = 0;
  const skills: PromptSkillAttachment[] = [];
  for (const match of source.matchAll(pattern)) {
    const slot = slots[Number(match[1])];
    const at = match.index ?? cursor;
    if (!slot) continue;
    text += source.slice(cursor, at);
    const start = text.length;
    text += slot.name;
    skills.push({
      id: slot.id,
      name: slot.name,
      mention: { start, end: text.length, text: slot.name },
    });
    cursor = at + match[0].length;
  }
  text += source.slice(cursor);
  return { text, skills };
}

const listTypes = new Set(["bullet_list", "ordered_list"]);

/**
 * Adjacent lists of the same type are one list in Markdown, so they are
 * serialized as one; the parser then rebuilds a single list.
 */
function mergeAdjacentLists(doc: PMNode): PMNode {
  const blocks: PMNode[] = [];
  doc.forEach((node) => {
    const previous = blocks[blocks.length - 1];
    if (previous && previous.type === node.type && listTypes.has(node.type.name)) {
      blocks[blocks.length - 1] = previous.type.create(
        { ...previous.attrs, tight: previous.attrs.tight === true && node.attrs.tight === true },
        previous.content.append(node.content),
        previous.marks,
      );
      return;
    }
    blocks.push(node);
  });
  return blocks.length === doc.childCount ? doc : doc.copy(Fragment.fromArray(blocks));
}

/** Serializes clipboard slice content, falling back to plain text. */
export function serializeSlice(content: Fragment): string {
  if (content.childCount === 0) return "";
  const inline = content.firstChild!.isInline && content.lastChild!.isInline;
  const node = inline
    ? schema.node("paragraph", null, content)
    : schema.topNodeType.validContent(content)
      ? schema.node("doc", null, content)
      : undefined;
  if (!node) {
    return content.textBetween(0, content.size, "\n", (child) => String(child.attrs.name ?? ""));
  }
  return serializeNode(node).text;
}

const placeholderStart = "\uE000";

let placeholderGeneration = 0;

/**
 * A placeholder prefix that does not occur in the given text, including after
 * numeric character references decode. Checking the text makes a collision
 * impossible without relying on randomness.
 */
function freshNonce(text: string): string {
  const decoded = decodeNumericEntities(text);
  let nonce = (placeholderGeneration++).toString(36);
  while (containsPlaceholderPrefix(decoded, nonce)) {
    nonce = (placeholderGeneration++).toString(36);
  }
  return nonce;
}

function containsPlaceholderPrefix(text: string, nonce: string): boolean {
  return text.includes(placeholderStart + nonce);
}

/**
 * Parses draft text. Skill mentions that still match the text become atoms;
 * stale or overlapping mentions stay ordinary text.
 */
export function parseDraft(text: string, skills: readonly PromptSkillAttachment[] = []): PMNode {
  const slots: MarkdownSkill[] = [];
  const nonce = freshNonce(text);
  let prepared = "";
  let end = 0;
  for (const skill of skills) {
    const mention = skill.mention;
    if (!mention || mention.start < end || text.slice(mention.start, mention.end) !== skill.name)
      continue;
    prepared += text.slice(end, mention.start) + placeholder(nonce, slots.length);
    slots.push({ id: skill.id, name: skill.name });
    end = mention.end;
  }
  prepared += text.slice(end);
  const doc = markdownParser.parse(prepared);
  if (slots.length === 0) return doc;
  const pattern = new RegExp(`${placeholderStart}${nonce}(\\d+)${placeholderStart}`, "g");
  return resolveSkills(doc, slots, pattern);
}

function placeholder(nonce: string, index: number): string {
  return `${placeholderStart}${nonce}${index}${placeholderStart}`;
}

function resolveSkills(doc: PMNode, slots: readonly MarkdownSkill[], pattern: RegExp): PMNode {
  const collect = (node: PMNode, inCode: boolean): PMNode[] => {
    if (node.isText) return splitSkillText(node, slots, pattern, inCode);
    if (node.isLeaf) return [node];
    const code = inCode || node.type.spec.code === true;
    const children: PMNode[] = [];
    node.forEach((child) => children.push(...collect(child, code)));
    return [node.copy(Fragment.fromArray(children))];
  };
  const children: PMNode[] = [];
  doc.forEach((child) => children.push(...collect(child, false)));
  return doc.copy(Fragment.fromArray(children));
}

function splitSkillText(
  node: PMNode,
  slots: readonly MarkdownSkill[],
  pattern: RegExp,
  inCode: boolean,
): PMNode[] {
  const value = node.text ?? "";
  const nodes: PMNode[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) nodes.push(schema.text(value.slice(cursor, match.index), node.marks));
    const slot = slots[Number(match[1])];
    const name = slot?.name ?? match[0];
    nodes.push(
      inCode
        ? schema.text(name, node.marks)
        : schema.node("skill", { id: slot?.id ?? "", name }, undefined, node.marks),
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) nodes.push(schema.text(value.slice(cursor), node.marks));
  return nodes;
}
