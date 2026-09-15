import type { PromptSkillAttachment } from "@opencode-ai/client";
import { Schema, type Node } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";

export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
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
  },
});

export function fromDraft(text: string, skills: readonly PromptSkillAttachment[]) {
  const paragraphs: Node[] = [],
    nodes: Node[] = [];
  const append = (value: string) => {
    const lines = value.split("\n");
    lines.forEach((line, index) => {
      if (index) {
        paragraphs.push(schema.node("paragraph", null, nodes.splice(0)));
      }
      if (line) nodes.push(schema.text(line));
    });
  };
  let end = 0;
  for (const skill of skills) {
    const mention = skill.mention;
    if (!mention || mention.start < end || text.slice(mention.start, mention.end) !== skill.name)
      continue;
    append(text.slice(end, mention.start));
    nodes.push(schema.node("skill", { id: skill.id, name: skill.name }));
    end = mention.end;
  }
  append(text.slice(end));
  paragraphs.push(schema.node("paragraph", null, nodes));
  return schema.node("doc", null, paragraphs);
}
export function toDraft(doc: Node) {
  let text = "";
  const skills: PromptSkillAttachment[] = [];
  doc.forEach((paragraph, _offset, index) => {
    if (index) text += "\n";
    paragraph.forEach((node) => {
      if (node.isText) text += node.text;
      else {
        const start = text.length;
        text += node.attrs.name;
        skills.push({
          id: node.attrs.id,
          name: node.attrs.name,
          mention: { start, end: text.length, text: node.attrs.name },
        });
      }
    });
  });
  return { text, skills };
}
export function slashQuery(
  state: EditorState,
): { text: string; from: number; to: number } | undefined {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return undefined;
  const before = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc");
  // Names may contain slashes (nested command directories); the whitespace or
  // start guard still keeps path text like `src/review` out of the menu.
  const match = /(?:^|\s)\/([^\s]*)$/.exec(before);
  return match
    ? { text: match[1]!, from: $from.pos - match[1]!.length - 1, to: $from.pos }
    : undefined;
}
