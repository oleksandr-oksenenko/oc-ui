import type { PromptSkillAttachment } from "@opencode/client";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vite-plus/test";

import { fromDraft, schema, toDraft } from "./document.ts";
import { mdastOptions, serializeMdast } from "./markdown-mdast.ts";

/**
 * Serializer-level checks for the private mdast converter: the production
 * draft must be a fixed point for a plain mdast consumer, schema content the
 * converter cannot map must throw instead of being flattened, and a code mark
 * around a break or image becomes separate code spans instead of a failure.
 */

const mention = (name: string, start: number): PromptSkillAttachment => ({
  id: name,
  name,
  mention: { start, end: start + name.length, text: name },
});

/** An mdast tree with positions dropped, so two trees compare structurally. */
function treeOf(source: string): string {
  return JSON.stringify(fromMarkdown(source), (key, value) =>
    key === "position" ? undefined : value,
  );
}

/** Drafts whose emitted Markdown must be canonical for a plain mdast reader. */
const drafts = [
  "",
  "hello",
  "a\nb",
  "a\n\nb",
  "2 * 3 = 6",
  "# Heading",
  "- one\n- two",
  "- one\n  - nested\n- two",
  "1. first\n2. second",
  "7. seven\n8. eight",
  "- a\n\n- b",
  "> quoted\n> lines",
  "```ts\nconst a = 1;\n```",
  "````\n```\n````",
  "---",
  "a **b** *c* `d` [f](https://x.dev/a)",
  "***both***",
  "a **`b`** c",
  "**a *b* c**",
  "keep `  spaced  ` code",
  "` a` and `b `",
  "![alt](x.png)",
  "<https://x.dev>",
  "a & b",
  "Use <Widget> here",
  "a < b and c > d",
  "🙂 emoji 🎉\n\n漢字",
  "* one\n+ two",
];

/** Drafts that carry a skill attachment, whose name is written as text. */
const skillDrafts = ["use review now", "# **review** now", "- review this", "> review this"];

describe("mdast serializer", () => {
  it("emits markdown that mdast-util-from-markdown reads back as the same tree", () => {
    const unstable: string[] = [];
    const check = (source: string, draft: ReturnType<typeof toDraft>) => {
      const tree = treeOf(draft.text);
      const again = toMarkdown(fromMarkdown(draft.text), mdastOptions).replace(/\n$/, "");
      if (treeOf(again) !== tree || draft.text.includes("\uE000")) unstable.push(source);
    };
    for (const source of drafts) check(source, toDraft(fromDraft(source)));
    for (const source of skillDrafts) {
      const start = source.indexOf("review");
      check(source, toDraft(fromDraft(source, [mention("review", start)])));
    }
    expect(unstable).toEqual([]);
  });

  it("throws on unsupported block and inline nodes", () => {
    const widget = foreign.node("doc", null, [foreign.node("widget", null, [foreign.text("x")])]);
    expect(() => serializeMdast(widget, () => "")).toThrow("Unsupported block node `widget`");
    const chip = foreign.node("doc", null, [
      foreign.node("paragraph", null, [foreign.node("chip")]),
    ]);
    expect(() => serializeMdast(chip, () => "")).toThrow("Unsupported inline node `chip`");
  });

  it("throws on an unsupported mark", () => {
    const marked = foreign.node("doc", null, [
      foreign.node("paragraph", null, [foreign.text("x", [foreign.marks.highlight.create()])]),
    ]);
    expect(() => serializeMdast(marked, () => "")).toThrow("Unsupported mark `highlight`");
  });

  it("splits a code mark into spans around content a code span cannot carry", () => {
    const code = schema.marks.code!.create();
    const breakDoc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("a", [code]),
        schema.node("hard_break", null, undefined, [code]),
        schema.text("b", [code]),
      ]),
    ]);
    expect(toDraft(breakDoc).text).toBe("`a`\n`b`");
    const breakRestored = fromDraft(toDraft(breakDoc).text);
    breakRestored.check();
    expect(breakRestored.textContent).toBe("ab");
    expect(markNames(breakRestored.firstChild!)).toEqual([["code"], [], ["code"]]);
    expect(breakRestored.firstChild!.child(1).type.name).toBe("hard_break");

    const image = schema.node("image", { src: "x.png", alt: "alt" }, undefined, [code]);
    const imageDoc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a", [code]), image, schema.text("b", [code])]),
    ]);
    expect(toDraft(imageDoc).text).toBe("`a`![alt](x.png)`b`");
    const imageRestored = fromDraft(toDraft(imageDoc).text);
    imageRestored.check();
    expect(imageRestored.textContent).toBe("ab");
    expect(markNames(imageRestored.firstChild!)).toEqual([["code"], [], ["code"]]);
    expect(imageRestored.firstChild!.child(1).type.name).toBe("image");
  });
});

/** The mark names on each child of a node, in order. */
function markNames(node: PMNode): string[][] {
  const names: string[][] = [];
  node.forEach((child) => names.push(child.marks.map((mark) => mark.type.name)));
  return names;
}

/**
 * A schema with node and mark names the composer does not define, so the
 * converter's default branches are reachable.
 */
const foreign = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    widget: { content: "text*", group: "block" },
    text: { group: "inline" },
    chip: { inline: true, group: "inline", atom: true },
  },
  marks: { highlight: {} },
});
