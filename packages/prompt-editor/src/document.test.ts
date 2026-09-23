import { describe, expect, it } from "vite-plus/test";
import type { PromptSkillAttachment } from "@opencode/client";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  fromDraft,
  fromPlainText,
  pasteContent,
  pastePlainText,
  schema,
  serializeSlice,
  slashQuery,
  toDraft,
} from "./document.ts";

const mention = (name: string, start: number, id = name): PromptSkillAttachment => ({
  id,
  name,
  mention: { start, end: start + name.length, text: name },
});

/** Parses draft text and rejects a document the schema cannot hold. */
function parse(text: string, skills: readonly PromptSkillAttachment[] = []) {
  const doc = fromDraft(text, skills);
  doc.check();
  return doc;
}

/**
 * Serializes draft text and proves the canonical text is a fixed point: the
 * document rebuilt from it serializes to exactly the same text. An authored
 * draft may normalize once (loose or adjacent lists, setext headings) without
 * ever changing again.
 */
function canonicalize(text: string, skills: readonly PromptSkillAttachment[] = []) {
  const doc = parse(text, skills);
  const draft = toDraft(doc);
  const restored = parse(draft.text, draft.skills);
  expect(toDraft(restored)).toEqual(draft);
  return { doc, draft, restored };
}

/** A canonical draft that still describes the same document. */
function roundTrip(text: string, skills: readonly PromptSkillAttachment[] = []) {
  const { doc, draft, restored } = canonicalize(text, skills);
  expect(restored.eq(doc)).toBe(true);
  expect(draft.text).toBe(text);
  return draft;
}

/** A document whose single paragraph has the given inline content. */
function paragraph(content: PMNode[]): PMNode {
  return schema.node("doc", null, [schema.node("paragraph", null, content)]);
}

/** Block type names and text of a pasted document, in order. */
function blocks(doc: PMNode): { type: string; text: string; breaks: number }[] {
  const result: { type: string; text: string; breaks: number }[] = [];
  doc.forEach((node) => {
    let breaks = 0;
    node.descendants((child) => {
      if (child.type.name === "hard_break") breaks += 1;
      return true;
    });
    result.push({ type: node.type.name, text: node.textContent, breaks });
  });
  return result;
}

/** The single skill atom in a document, or `undefined` when it has none. */
function skillAtom(doc: PMNode): PMNode | undefined {
  let found: PMNode | undefined;
  doc.descendants((node) => {
    if (found === undefined && node.type.name === "skill") found = node;
    return true;
  });
  return found;
}

describe("prompt document", () => {
  it("drops trailing line breaks instead of writing empty lines", () => {
    const breakType = schema.nodes.hard_break!;
    const trailing = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), breakType.create()]),
    ]);
    expect(toDraft(trailing)).toEqual({ text: "a", skills: [] });
    const doubled = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), breakType.create(), breakType.create()]),
    ]);
    expect(toDraft(doubled)).toEqual({ text: "a", skills: [] });
    // A break with text after it is kept.
    const kept = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), breakType.create(), schema.text("b")]),
    ]);
    expect(toDraft(kept).text).toBe("a\nb");
  });

  it("keeps only the hard-break marks Markdown can read back", () => {
    const strong = schema.marks.strong!.create();
    const marked = (text: string) => schema.text(text, [strong]);
    const markedBreak = schema.node("hard_break", null, undefined, [strong]);
    // A mark that spans the break stays around both lines.
    expect(toDraft(paragraph([marked("a"), markedBreak, marked("b")])).text).toBe("**a\nb**");
    // A mark that would start or end at the break is dropped: a newline inside
    // the delimiter pair is not readable back, so the mark has no Markdown form.
    expect(toDraft(paragraph([marked("a"), markedBreak, schema.text("b")])).text).toBe("**a**\nb");
    expect(toDraft(paragraph([schema.text("a"), markedBreak, marked("b")])).text).toBe("a\n**b**");
  });

  it("leaves stale and overlapping mentions as ordinary text", () => {
    const valid = mention("review", 0);
    expect(toDraft(parse("review", [valid, valid, { ...valid, name: "other" }]))).toEqual({
      text: "review",
      skills: [valid],
    });
  });

  it("allows a skill atom at every heading level", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const marker = "#".repeat(level);
      const text = `${marker} review`;
      const skills = [mention("review", marker.length + 1)];
      const doc = parse(text, skills);
      expect(doc.firstChild?.type.name).toBe("heading");
      expect(doc.firstChild?.attrs.level).toBe(level);
      expect(roundTrip(text, skills)).toEqual({ text, skills });
    }
  });

  it("keeps a skill atom's marks and offsets when the draft is parsed", () => {
    const cases: ReadonlyArray<readonly [string, number, readonly string[]]> = [
      ["*review* now", 1, ["em"]],
      ["**review** now", 2, ["strong"]],
      ["***review*** now", 3, ["em", "strong"]],
      ["[review](https://x.dev)", 1, ["link"]],
      ["**a *review* c**", 5, ["em", "strong"]],
      ["**a** *review* `b`", 7, ["em"]],
      ["# **review** now", 4, ["strong"]],
      ["## *review* now", 4, ["em"]],
      ["### ***review*** now", 7, ["em", "strong"]],
      ["#### [review](https://x.dev)", 6, ["link"]],
    ];
    for (const [source, start, marks] of cases) {
      const doc = parse(source, [mention("review", start)]);
      const atom = skillAtom(doc);
      expect(atom?.marks.map((mark) => mark.type.name)).toEqual(marks);
      expect(atom?.attrs.name).toBe("review");
      expect(toDraft(doc).skills).toEqual([mention("review", start)]);
    }
  });

  it("keeps headings valid when transactions insert and remove a skill", () => {
    const doc = parse("# review now", [mention("review", 2)]);
    const state = EditorState.create({ schema, doc });

    // The suggestion menu replaces the typed query with a skill atom and text.
    const inserted = state.apply(
      state.tr.replaceWith(6, 6, [
        schema.node("skill", { id: "other", name: "other" }),
        schema.text(" now"),
      ]),
    ).doc;
    inserted.check();
    const draft = toDraft(inserted);
    expect(draft).toEqual({
      text: "# review nowother now",
      skills: [mention("review", 2), mention("other", 12)],
    });
    expect(fromDraft(draft.text, draft.skills).eq(inserted)).toBe(true);

    // The chip's remove button deletes the atom and one following space.
    const removed = state.apply(state.tr.delete(1, 3)).doc;
    removed.check();
    expect(removed.firstChild?.type.name).toBe("heading");
    expect(toDraft(removed)).toEqual({ text: "# now", skills: [] });
  });

  it("keeps a mention inside code as text instead of an atom", () => {
    const text = "```\nreview\n```";
    const doc = parse(text, [mention("review", 4)]);
    expect(doc.textContent).toBe("review");
    expect(doc.firstChild?.type.name).toBe("code_block");
    expect(toDraft(doc)).toEqual({ text, skills: [] });
  });

  it("keeps a literal placeholder from stealing an attachment", () => {
    const literalText = "\uE000k0\uE000 review";
    const skills = [mention("review", 5)];
    const doc = parse(literalText, skills);
    const draft = toDraft(doc);
    expect(draft.text).toBe(literalText);
    expect(draft.skills).toEqual(skills);
  });

  it("does not let an encoded marker steal an attachment", () => {
    const source = "&#xE000;00&#xE000; review";
    const doc = parse(source, [mention("review", 19)]);
    let atoms = 0;
    doc.descendants((node) => {
      if (node.type.name === "skill") atoms += 1;
      return true;
    });
    expect(atoms).toBe(1);
    expect(toDraft(doc).text).toContain("review");
  });

  it("uses model positions after an atomic skill and respects word boundaries", () => {
    const skill = mention("review", 0);
    const doc = fromDraft("review /te", [skill]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 6) });
    expect(slashQuery(state)).toEqual({ text: "te", from: 3, to: 6 });
    const path = fromDraft("src/re", []);
    expect(
      slashQuery(
        EditorState.create({ schema, doc: path, selection: TextSelection.create(path, 7) }),
      ),
    ).toBeUndefined();
    expect(
      slashQuery(state.apply(state.tr.setSelection(TextSelection.create(doc, 3, 6)))),
    ).toBeUndefined();
  });

  it("keeps nested command names in the slash query", () => {
    const doc = fromDraft("/nested/for", []);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 12) });
    expect(slashQuery(state)).toEqual({ text: "nested/for", from: 1, to: 12 });
  });

  it("finds a slash query inside list items and quotes", () => {
    const list = fromDraft("- /te", []);
    expect(
      slashQuery(
        EditorState.create({ schema, doc: list, selection: TextSelection.create(list, 6) }),
      ),
    ).toEqual({ text: "te", from: 3, to: 6 });
    const quote = fromDraft("> /te", []);
    expect(
      slashQuery(
        EditorState.create({ schema, doc: quote, selection: TextSelection.create(quote, 5) }),
      ),
    ).toEqual({ text: "te", from: 2, to: 5 });
  });

  it("takes no suggestions inside a code block", () => {
    const doc = fromDraft("```\n/te\n```", []);
    const state = EditorState.create({ schema, doc });
    expect(slashQuery(state)).toBeUndefined();
  });

  it("copies a skill atom as its name", () => {
    const doc = parse("review this", [mention("review", 0)]);
    const skill = doc.firstChild!.firstChild!;
    expect(serializeSlice(Fragment.from(skill))).toBe("review");
  });

  it("serializes partial clipboard fragments", () => {
    const strong = schema.marks.strong!.create();
    const review = schema.node("skill", { id: "review", name: "review" });
    const cases: ReadonlyArray<readonly [Fragment, string]> = [
      [Fragment.empty, ""],
      [Fragment.from(schema.text("plain")), "plain"],
      [Fragment.from(schema.text("bold", [strong])), "**bold**"],
      [Fragment.from([review, schema.text(" now")]), "review now"],
      [Fragment.from([schema.text("a"), schema.node("hard_break"), schema.text("b")]), "a\nb"],
      // A trailing break carries no text and is dropped.
      [Fragment.from([schema.text("a"), schema.node("hard_break")]), "a"],
      [
        Fragment.from([
          schema.node("paragraph", null, [schema.text("one")]),
          schema.node("bullet_list", { tight: true }, [
            schema.node("list_item", null, [schema.node("paragraph", null, [schema.text("two")])]),
          ]),
        ]),
        "one\n\n- two",
      ],
    ];
    for (const [content, text] of cases) {
      expect(serializeSlice(content)).toBe(text);
    }
    // A fragment that is not document content falls back to its plain text,
    // writing each skill atom as its name.
    const item = Fragment.from(
      schema.node("list_item", null, [schema.node("paragraph", null, [review])]),
    );
    expect(serializeSlice(item)).toBe("review");
  });

  it("pastes code literally and Markdown elsewhere", () => {
    const code = fromDraft("```\na\n```");
    const codeState = EditorState.create({
      schema,
      doc: code,
      selection: TextSelection.atEnd(code),
    });
    expect(pasteContent(codeState, "b\nc").doc.textContent).toBe("ab\nc");
    expect(pasteContent(codeState, "**x**").doc.textContent).toBe("a**x**");

    const empty = fromDraft("");
    const emptyState = EditorState.create({
      schema,
      doc: empty,
      selection: TextSelection.atEnd(empty),
    });
    const pasted = pasteContent(emptyState, "- one\n- two").doc;
    pasted.check();
    expect(toDraft(pasted)).toEqual({ text: "- one\n- two", skills: [] });
  });

  it("pastes plain text with hard breaks and paragraph breaks, not Markdown", () => {
    const empty = fromDraft("");
    const state = EditorState.create({
      schema,
      doc: empty,
      selection: TextSelection.atEnd(empty),
    });
    const pasted = pastePlainText(state, "first line\nsecond line\n\n# not a heading").doc;
    pasted.check();
    expect(blocks(pasted)).toEqual([
      { type: "paragraph", text: "first linesecond line", breaks: 1 },
      { type: "paragraph", text: "# not a heading", breaks: 0 },
    ]);
    expect(toDraft(pasted)).toEqual({
      // The serializer escapes the leading marker so reparsing keeps it literal.
      text: "first line\nsecond line\n\n\\# not a heading",
      skills: [],
    });

    // Markers that Markdown would interpret stay literal characters: a list is
    // not a list and emphasis is not a mark.
    const markers = pastePlainText(state, "- one\n- two\n\n**bold**").doc;
    markers.check();
    expect(blocks(markers)).toEqual([
      { type: "paragraph", text: "- one- two", breaks: 1 },
      { type: "paragraph", text: "**bold**", breaks: 0 },
    ]);
    let marks = 0;
    markers.descendants((node) => {
      marks += node.marks.length;
      return true;
    });
    expect(marks).toBe(0);
  });

  it("keeps literal whitespace and drops only structural blank lines", () => {
    const trailing = fromPlainText("a  \nb");
    trailing.check();
    expect(blocks(trailing)).toEqual([{ type: "paragraph", text: "a  b", breaks: 1 }]);

    // Leading, trailing and repeated blank lines create no empty paragraphs.
    const padded = fromPlainText("\n\nfirst\n\n\n\nsecond\n\n");
    padded.check();
    expect(blocks(padded)).toEqual([
      { type: "paragraph", text: "first", breaks: 0 },
      { type: "paragraph", text: "second", breaks: 0 },
    ]);

    // Carriage returns normalize, so a Windows clipboard paste keeps its lines.
    const windows = fromPlainText("one\r\ntwo\rthree");
    windows.check();
    expect(blocks(windows)).toEqual([{ type: "paragraph", text: "onetwothree", breaks: 2 }]);
  });

  it("pastes raw newlines into a code block", () => {
    const code = fromDraft("```\na\n```");
    const codeState = EditorState.create({
      schema,
      doc: code,
      selection: TextSelection.atEnd(code),
    });
    expect(pastePlainText(codeState, "b\nc").doc.textContent).toBe("ab\nc");
    expect(pastePlainText(codeState, "*x*").doc.textContent).toBe("a*x*");
  });
});
