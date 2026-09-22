import { describe, expect, it } from "vite-plus/test";
import type { PromptSkillAttachment } from "@opencode/client";
import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  fromDraft,
  fromPlainText,
  pasteContent,
  pastePlainText,
  schema,
  serializeSlice,
  slashQuery,
  sliceHasInsertableContent,
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

/** A document whose block content is exactly the written text. */
function literal(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text === "" ? [] : [schema.text(text)]),
  ]);
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

/** A paragraph node with the given inline content. */
const paragraphBlock = (content: PMNode[]) => schema.node("paragraph", null, content);

/** A closed slice containing exactly one node. */
const singleNodeSlice = (node: PMNode) => new Slice(Fragment.from(node), 0, 0);

describe("prompt document", () => {
  it("keeps plain text and single newlines canonical", () => {
    for (const text of ["", "hello", "a\nb", "a\n\nb", "first\nsecond\nthird"]) {
      expect(roundTrip(text).text).toBe(text);
    }
    // A trailing newline is not a line of its own.
    expect(canonicalize("a\n").draft.text).toBe("a");
  });

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

  it("escapes text that would otherwise parse as Markdown", () => {
    const math = canonicalize("2 * 3 = 6");
    expect(math.draft.text).toBe("2 \\* 3 = 6");
    expect(math.restored.textContent).toBe("2 * 3 = 6");

    for (const [source, text] of [
      ["- not a list", "\\- not a list"],
      ["# not a heading", "\\# not a heading"],
      ["> not a quote", "\\> not a quote"],
      ["1. not ordered", "1\\. not ordered"],
      ["1) not ordered", "1\\) not ordered"],
      ["use **literal**", "use \\*\\*literal\\*\\*"],
      // The transcript renders GFM strikethrough (marked accepts one or two
      // tildes), but the composer has no strikethrough mark, so every literal
      // tilde is escaped.
      ["~~plain~~", "\\~\\~plain\\~\\~"],
      ["a ~~b~~ c", "a \\~\\~b\\~\\~ c"],
      ["~text~", "\\~text\\~"],
      ["a ~ b", "a \\~ b"],
    ] as const) {
      const doc = literal(source);
      const draft = toDraft(doc);
      expect(draft.text).toBe(text);
      expect(parse(draft.text).eq(doc)).toBe(true);
    }
  });

  it("preserves mention offsets across lines and repeated skills", () => {
    const text = "🙂\n\nreview and review";
    const skills = [4, 15].map((start) => ({
      id: "review",
      name: "review",
      mention: { start, end: start + 6, text: "review" },
    }));
    expect(toDraft(parse(text, skills))).toEqual({ text, skills });
  });

  it("leaves stale and overlapping mentions as ordinary text", () => {
    const valid = mention("review", 0);
    expect(toDraft(parse("review", [valid, valid, { ...valid, name: "other" }]))).toEqual({
      text: "review",
      skills: [valid],
    });
  });

  it("round-trips block structure", () => {
    for (const source of [
      "# Heading",
      "- one\n- two",
      "- one\n  - nested\n- two",
      "1. first\n2. second",
      "3. third\n4. fourth",
      "> quoted\n> lines",
      "```ts\nconst a = 1;\n```",
      "````\n```\n````",
      "---",
      "# Heading\n\n- one\n- two\n\n> quoted\n\n```\ncode\n```",
      "1. first\n   - nested\n2. second",
      "- item\n\n  second paragraph",
    ]) {
      expect(roundTrip(source).text).toBe(source);
    }
    // A tight item keeps its following block without an injected blank line.
    expect(canonicalize("- item\n  ```\n  code\n  ```").draft.text).toBe(
      "- item\n  ```\n  code\n  ```",
    );
  });

  it("keeps ordered list start values", () => {
    for (const source of [
      "1. first\n2. second",
      "3. third\n4. fourth",
      "7. seven\n8. eight",
      "10. ten\n11. eleven",
    ]) {
      expect(roundTrip(source).text).toBe(source);
    }
    // The bundled parser reads `0.` as the default start of 1.
    expect(canonicalize("0. zero\n1. one").draft.text).toBe("1. zero\n2. one");
  });

  it("canonicalizes authored Markdown without losing it", () => {
    for (const [source, text] of [
      ["* one\n+ two", "- one\n- two"],
      ["Title\n===", "# Title"],
      ["1) item", "1. item"],
      ["~~~\ncode\n~~~", "```\ncode\n```"],
      ["> quote\nlazy", "> quote\n> lazy"],
      // Nested identical emphasis collapses to one bold run, keeping the tail.
      ["**a __b__ c**", "**a b c**"],
      // Loose and tight lists keep their blank-line shape.
      ["- a\n\n- b", "- a\n\n- b"],
      // A list may start at zero.
      // The bundled parser reads `0.` as the default start of 1.
      ["0. zero\n1. one", "1. zero\n2. one"],
    ] as const) {
      expect(canonicalize(source).draft.text).toBe(text);
    }
    // Two adjacent lists of one type cannot be told apart in Markdown, so the
    // serialized text is a single list and stays stable.
    const adjacent = canonicalize("* one\n+ two");
    expect(adjacent.restored.eq(parse(adjacent.draft.text))).toBe(true);
    // Inline images are part of the bundled schema, so image syntax
    // round-trips as an image node.
    expect(canonicalize("![alt](x.png)").draft.text).toBe("![alt](x.png)");
  });

  it("escapes literal line starts after a line break", () => {
    const built = ["- b", "+ b", "* b", "> b", "# b", "1. b", "1) b", "===", "---", "```"].map(
      (marker) => ({
        marker,
        doc: schema.node("doc", null, [
          schema.node("paragraph", null, [
            schema.text("a"),
            schema.node("hard_break"),
            schema.text(marker),
          ]),
        ]),
      }),
    );
    const outcomes = built.map(({ marker, doc }) => {
      const draft = toDraft(doc);
      return { marker, equal: parse(draft.text).eq(doc), hasBreak: draft.text.includes("\n") };
    });
    expect(outcomes).toEqual(built.map(({ marker }) => ({ marker, equal: true, hasBreak: true })));
  });

  it("escapes literal entity, tag and autolink syntax", () => {
    for (const source of [
      "Use <Widget> here",
      "literal &amp; text",
      "<https://x.dev>",
      "a < b and c > d",
      "<!-- important -->",
      "<!DOCTYPE html>",
    ]) {
      const doc = literal(source);
      const draft = toDraft(doc);
      expect(parse(draft.text).eq(doc)).toBe(true);
    }
  });

  it("round-trips inline marks, links and code spans", () => {
    for (const source of [
      "a **b** *c* `d` [f](https://x.dev/a)",
      "***both***",
      "a **`b`** c",
      "use `a\\*b` here",
      "keep `  spaced  ` code",
    ]) {
      expect(roundTrip(source).text).toBe(source);
    }
    // Only a space on both edges would be stripped by CommonMark, so a
    // one-sided space needs no padding.
    expect(canonicalize("` a` and `b `").draft.text).toBe("` a` and `b `");
    // Edge whitespace inside emphasis is written as character references, so
    // the document keeps it instead of expelling it.
    const spaced = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text(" bold ", [schema.marks.strong!.create()])]),
    ]);
    const draft = toDraft(spaced);
    expect(draft.text).toBe("**&#x20;bold&#x20;**");
    const spacedRestored = fromDraft(draft.text);
    expect(spacedRestored.eq(spaced)).toBe(true);
    expect(spacedRestored.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      "strong",
    ]);
  });

  it("round-trips skills inside marks and blocks", () => {
    for (const [text, skills] of [
      ["review this", [mention("review", 0)]],
      ["**review** now", [mention("review", 2)]],
      ["- review this", [mention("review", 2)]],
      ["> review this", [mention("review", 2)]],
      ["`review`", [mention("review", 1)]],
    ] as const) {
      expect(roundTrip(text, skills)).toEqual({ text, skills });
    }
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

  it("round-trips marked skills in headings", () => {
    for (const [text, start] of [
      ["# **review** now", 4],
      ["## *review* now", 4],
      ["### ***review*** now", 7],
      ["#### [review](https://x.dev)", 6],
    ] as const) {
      const skills = [mention("review", start)];
      expect(roundTrip(text, skills)).toEqual({ text, skills });
    }
  });

  it("keeps mention offsets after unicode text", () => {
    for (const text of ["🙂 review", "漢字 review", "e\u0301 review", "👨‍👩‍👧 review"]) {
      const start = text.indexOf("review");
      const skills = [mention("review", start)];
      const draft = roundTrip(text, skills);
      expect(draft).toEqual({ text, skills });
      expect(draft.text.slice(start, start + 6)).toBe("review");
    }
  });

  it("round-trips markdown-significant skill names", () => {
    for (const name of [
      "a*b",
      "**bold**",
      "# hash",
      "`tick`",
      "[link](x)",
      "~~strike~~",
      "a_b_c",
      "1. item",
      "a\\b",
      // A name shaped like a nonce placeholder stays an attachment.
      "\uE000k0\uE000",
    ]) {
      const text = `use ${name} now`;
      const skills = [mention(name, text.indexOf(name))];
      const draft = roundTrip(text, skills);
      expect(draft).toEqual({ text, skills });
      expect(draft.text.slice(4, 4 + name.length)).toBe(name);
    }
  });

  it("round-trips marked skill atoms", () => {
    for (const [text, start] of [
      ["*review* now", 1],
      ["**review** now", 2],
      ["***review*** now", 3],
      ["[review](https://x.dev)", 1],
      ["**a *review* c**", 5],
      ["**a** *review* `b`", 7],
    ] as const) {
      const skills = [mention("review", start)];
      expect(roundTrip(text, skills)).toEqual({ text, skills });
    }
  });

  it("keeps a skill slot whose placeholder mdast encodes next to a delimiter", () => {
    // `mdast-util-to-markdown` writes the placeholder's leading character as
    // `&#xE000;` after an emphasis that closes at a code span; the serializer
    // must still find the slot instead of leaking the placeholder as text.
    const doc = paragraph([
      schema.text("a", [schema.marks.em!.create()]),
      schema.text("b", [schema.marks.em!.create(), schema.marks.code!.create()]),
      schema.node("skill", { id: "aa", name: "aa" }),
    ]);
    const draft = toDraft(doc);
    expect(draft).toEqual({ text: "*a`b`*aa", skills: [mention("aa", 6)] });

    // The emphasis delimiter itself is the documented corpus loss; the atom
    // must survive the reparse with its identity.
    const reparsed = fromDraft(draft.text, draft.skills);
    const names: string[] = [];
    reparsed.descendants((node) => {
      if (node.type.name === "skill") names.push(String(node.attrs.name));
      return true;
    });
    expect(names).toEqual(["aa"]);
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

  it("keeps out-of-range character references as text", () => {
    for (const source of ["&#9999999; explain", "&#x110000; explain"]) {
      const doc = parse(source);
      const draft = toDraft(doc);
      expect(parse(draft.text).eq(doc)).toBe(true);
    }
    // Inside code the reference is written back verbatim.
    const fenced = "```\n&#xFFFFFFF;\n```";
    expect(toDraft(parse(fenced)).text).toBe(fenced);
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

  it("treats empty and whitespace-only slices as nothing to insert", () => {
    expect(sliceHasInsertableContent(Slice.empty)).toBe(false);
    expect(sliceHasInsertableContent(singleNodeSlice(paragraphBlock([])))).toBe(false);
    expect(sliceHasInsertableContent(singleNodeSlice(paragraphBlock([schema.text("   ")])))).toBe(
      false,
    );
    expect(sliceHasInsertableContent(singleNodeSlice(paragraphBlock([schema.text("hi")])))).toBe(
      true,
    );
    // An image is content even though it carries no text.
    expect(
      sliceHasInsertableContent(
        singleNodeSlice(schema.node("image", { src: "https://example.com/a.png" })),
      ),
    ).toBe(true);
  });
});
