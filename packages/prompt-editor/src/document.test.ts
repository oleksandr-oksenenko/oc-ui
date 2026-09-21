import { describe, expect, it } from "vite-plus/test";
import type { PromptSkillAttachment } from "@opencode/client";
import { Fragment } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  fromDraft,
  pasteContent,
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

/** A document whose block content is exactly the written text. */
function literal(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text === "" ? [] : [schema.text(text)]),
  ]);
}

describe("prompt document", () => {
  it("keeps plain text and single newlines canonical", () => {
    for (const text of ["", "hello", "a\nb", "a\n\nb", "first\nsecond\nthird"]) {
      expect(roundTrip(text).text).toBe(text);
    }
    // A trailing newline is not a line of its own.
    expect(canonicalize("a\n").draft.text).toBe("a");
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
      ["~~plain~~", "\\~\\~plain\\~\\~"],
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
    // A block after an item's first paragraph is separated by a blank line.
    expect(canonicalize("- item\n  ```\n  code\n  ```").draft.text).toBe(
      "- item\n\n  ```\n  code\n  ```",
    );
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
    // A span that starts or ends with a space keeps it through padding.
    expect(canonicalize("` a` and `b `").draft.text).toBe("`  a ` and ` b  `");
    // Leading and trailing whitespace is expelled from emphasis, so the
    // marked text stays visible without an unparseable delimiter pair.
    const spaced = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text(" bold ", [schema.marks.strong!.create()])]),
    ]);
    const draft = toDraft(spaced);
    expect(draft.text).toBe(" **bold** ");
    // CommonMark cannot represent a paragraph whose edges are spaces, so the
    // whitespace outside the emphasis is not part of the parsed document.
    expect(fromDraft(draft.text).textContent).toBe("bold");
    expect(
      fromDraft(draft.text).firstChild?.firstChild?.marks.map((mark) => mark.type.name),
    ).toEqual(["strong"]);
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
});
