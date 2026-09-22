import type { PromptSkillAttachment } from "@opencode/client";
import MarkdownIt from "markdown-it";
import { Fragment, type Node as PMNode, Schema } from "prosemirror-model";
import { defaultMarkdownParser, MarkdownParser, schema as baseSchema } from "prosemirror-markdown";

import { serializeMdast } from "./markdown-mdast.ts";
import { decodeNumericEntities } from "./markdown-text.ts";

/**
 * Drafts are CommonMark: the same text the model receives. Parsing is owned by
 * `prosemirror-markdown` and serialization by `mdast-util-to-markdown` (see
 * `markdown-mdast.ts`), so the composer, the transcript, and the model all
 * read one dialect.
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
 * app's inline skill atom. Lists, code blocks, images, links and their
 * attributes keep the bundled behavior, and the parser and serializer below
 * are built against this exact instance.
 *
 * The bundled heading allows only text and images, but a mention in a heading
 * parses into a skill atom, so headings admit the atom as well. The rest of
 * the bundled heading spec (attrs, parseDOM, toDOM, defining) is unchanged.
 */
export const schema: Schema = new Schema({
  nodes: baseSchema.spec.nodes
    .update("heading", {
      ...baseSchema.spec.nodes.get("heading")!,
      content: "(text | image | skill)*",
    })
    .append({
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
  const nonce = freshNonce(node.textContent);
  const slots: MarkdownSkill[] = [];
  const source = serializeMdast(node, (skill) => {
    slots.push({ id: String(skill.attrs.id ?? ""), name: String(skill.attrs.name ?? "") });
    return placeholder(nonce, slots.length - 1);
  });
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

/** Serializes clipboard slice content, falling back to plain text. */
export function serializeSlice(content: Fragment): string {
  if (content.childCount === 0) return "";
  const inline = content.firstChild!.isInline && content.lastChild!.isInline;
  const node = inline
    ? schema.node("doc", null, [schema.node("paragraph", null, content)])
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
