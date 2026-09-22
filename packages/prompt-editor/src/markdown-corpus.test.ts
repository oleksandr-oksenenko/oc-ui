import type { PromptSkillAttachment } from "@opencode/client";
import type { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vite-plus/test";

import { fromDraft, schema, toDraft } from "./document.ts";

/**
 * Frozen markdown corpus for the composer codec.
 *
 * This is the contract the serializer must satisfy. It is intentionally
 * independent of any particular serializer implementation: it asserts document
 * round-trips, draft stability, composer conventions, and skill offsets.
 *
 * Cases listed in `KNOWN_LOSSES` are representational losses that Markdown
 * cannot express. They must stay losses — never silently pass — and their
 * outputs must stay stable.
 */

const mention = (name: string, start: number, id = name): PromptSkillAttachment => ({
  id,
  name,
  mention: { start, end: start + name.length, text: name },
});

function parse(text: string, skills: readonly PromptSkillAttachment[] = []): PMNode {
  const doc = fromDraft(text, skills);
  doc.check();
  return doc;
}

/** A document whose block content is exactly the written text. */
function literal(text: string): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text === "" ? [] : [schema.text(text)]),
  ]);
}

/** A paragraph whose second line is exactly the marker text. */
function afterBreak(marker: string): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("a"),
      schema.node("hard_break"),
      schema.text(marker),
    ]),
  ]);
}

/** An ordered list of single-line items, starting at `order`. */
function orderedList(order: number, ...items: string[]): PMNode {
  return schema.node(
    "ordered_list",
    { order, tight: true },
    items.map((item) =>
      schema.node("list_item", null, [schema.node("paragraph", null, [schema.text(item)])]),
    ),
  );
}

const KNOWN_LOSSES = new Set(["adjacent bullet lists", "adjacent ordered lists"]);

/**
 * Cases whose draft is not yet a fixed point. Empty since the mdast
 * serializer: every corpus draft is stable under serialize, parse, serialize.
 */
const KNOWN_UNSTABLE = new Set<string>();

const corpus: ReadonlyArray<readonly [string, PMNode]> = [
  ["empty", parse("")],
  ["plain", parse("hello")],
  ["hard break", parse("a\nb")],
  ["blank line", parse("a\n\nb")],
  ["multiple hard breaks", parse("first\nsecond\nthird")],
  ["trailing newline", parse("a\n")],
  ["literal asterisk", literal("2 * 3 = 6")],
  ["literal bullet", literal("- not a list")],
  ["literal heading", literal("# not a heading")],
  ["literal quote", literal("> not a quote")],
  ["literal ordered dot", literal("1. not ordered")],
  ["literal ordered paren", literal("1) not ordered")],
  ["literal strong", literal("use **literal**")],
  ["literal strikethrough", literal("~~plain~~")],
  ["literal strikethrough mid-line", literal("a ~~b~~ c")],
  ["heading", parse("# Heading")],
  ["bullet list", parse("- one\n- two")],
  ["nested bullet list", parse("- one\n  - nested\n- two")],
  ["ordered list", parse("1. first\n2. second")],
  ["ordered list start", parse("3. third\n4. fourth")],
  ["blockquote", parse("> quoted\n> lines")],
  ["code block language", parse("```ts\nconst a = 1;\n```")],
  ["code block fence", parse("````\n```\n````")],
  ["thematic break", parse("---")],
  ["mixed blocks", parse("# Heading\n\n- one\n- two\n\n> quoted\n\n```\ncode\n```")],
  ["ordered list with nested bullet", parse("1. first\n   - nested\n2. second")],
  ["loose list", parse("- a\n\n- b")],
  ["item with second paragraph", parse("- item\n\n  second paragraph")],
  ["item with following code block", parse("- item\n  ```\n  code\n  ```")],
  ["adjacent bullet lists", parse("* one\n+ two")],
  [
    "adjacent ordered lists",
    schema.node("doc", null, [orderedList(3, "three", "four"), orderedList(1, "one", "two")]),
  ],
  ["setext heading", parse("Title\n===")],
  ["ordered paren marker", parse("1) item")],
  ["tilde fence", parse("~~~\ncode\n~~~")],
  ["lazy blockquote", parse("> quote\nlazy")],
  ["nested identical emphasis", parse("**a __b__ c**")],
  ["ordered list from zero", parse("0. zero\n1. one")],
  ["image", parse("![alt](x.png)")],
  ["image with title", parse('![alt](x.png "t")')],
  ["link", parse("[f](https://x.dev/a)")],
  ["link with title", parse('[f](https://x.dev/a "t")')],
  ["autolink", parse("<https://x.dev>")],
  ["inline marks", parse("a **b** *c* `d` [f](https://x.dev/a)")],
  ["nested emphasis and strong", parse("***both***")],
  ["strong code span", parse("a **`b`** c")],
  ["escaped asterisk in code", parse("use `a\\*b` here")],
  ["code span edge spaces", parse("keep `  spaced  ` code")],
  ["code span one-sided spaces", parse("` a` and `b `")],
  ["hard break inside emphasis", parse("**a\nb**")],
  // The parser drops the whole setext heading: its text would contain a hard
  // break, which the heading schema forbids, so only an empty paragraph
  // remains. The corpus pins that empty result; the parser test below states
  // the loss directly. This is not heading-with-break coverage.
  ["setext heading with hard break loses content", parse("a\nb\n===")],
  [
    "spaced strong",
    schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text(" bold ", [schema.marks.strong!.create()])]),
    ]),
  ],
  [
    "space between strong runs",
    schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("a "),
        schema.text("b", [schema.marks.strong!.create()]),
        schema.text(" c"),
      ]),
    ]),
  ],
  ["link across break", parse("[a\nb](https://x.dev)")],
  ["unicode emoji", parse("🙂 emoji 🎉\n\n漢字")],
  ["unicode after break", parse("é\nü")],
  // Escaping corpus: literal text must not read as Markdown on reparse.
  ["literal entity", literal("literal &amp; text")],
  ["literal ampersand", literal("a & b")],
  ["literal tag", literal("Use <Widget> here")],
  ["literal autolink", literal("<https://x.dev>")],
  ["literal angle text", literal("a < b and c > d")],
  ["literal comment", literal("<!-- important -->")],
  ["literal doctype", literal("<!DOCTYPE html>")],
  ["literal named entity", literal("&copy; x")],
  ["literal numeric entity", literal("&#x1F600; x")],
  ["literal placeholder", literal("\uE000k0\uE000 review")],
  ["out-of-range reference", parse("&#9999999; explain")],
  ["out-of-range hex reference", parse("&#x110000; explain")],
  ...["- b", "+ b", "* b", "> b", "# b", "1. b", "1) b", "===", "---", "```"].map(
    (marker) => [`line start ${JSON.stringify(marker)}`, afterBreak(marker)] as const,
  ),
  // Skill atoms.
  ["skill", parse("review this", [mention("review", 0)])],
  ["skill in strong", parse("**review** now", [mention("review", 2)])],
  ["skill in heading", parse("# review", [mention("review", 2)])],
  ["skill in list", parse("- review this", [mention("review", 2)])],
  ["skill in quote", parse("> review this", [mention("review", 2)])],
  ["skill in code mark", parse("`review`", [mention("review", 1)])],
  [
    "skill repeated after emoji",
    parse("🙂\n\nreview and review", [mention("review", 4), mention("review", 15)]),
  ],
  [
    "stale mention",
    parse("review", [
      mention("review", 0),
      mention("review", 0),
      { ...mention("other", 0), name: "other" },
    ]),
  ],
  ["mention in code block", parse("```\nreview\n```", [mention("review", 4)])],
  ["encoded placeholder", parse("&#xE000;00&#xE000; review", [mention("review", 19)])],
  ["literal placeholder text", parse("\uE000k0\uE000 review", [mention("review", 5)])],
  ["code reference", parse("```\n&#xFFFFFFF;\n```")],
];

function roundTrip(doc: PMNode) {
  const draft = toDraft(doc);
  const reparsed = fromDraft(draft.text, draft.skills);
  return { draft, reparsed, again: toDraft(reparsed) };
}

describe("markdown corpus", () => {
  it("round-trips every case except the documented losses", () => {
    const failures: string[] = [];
    for (const [name, doc] of corpus) {
      const { reparsed } = roundTrip(doc);
      if (!reparsed.eq(doc) && !KNOWN_LOSSES.has(name)) failures.push(name);
    }
    expect(failures).toEqual([]);
  });

  it("documents the known losses instead of letting them pass silently", () => {
    for (const [name, doc] of corpus) {
      if (!KNOWN_LOSSES.has(name)) continue;
      const { reparsed } = roundTrip(doc);
      expect(reparsed.eq(doc), `${name} unexpectedly round-trips`).toBe(false);
    }
    // Adjacent ordered lists merge into the first list, and its start is kept:
    // the second list's items continue the first list's numbering. Markdown
    // has no spelling that separates two ordered lists at the same indent.
    const merged = roundTrip(
      schema.node("doc", null, [orderedList(3, "three", "four"), orderedList(1, "one", "two")]),
    );
    expect(merged.draft.text).toBe("3. three\n4. four\n5. one\n6. two");
    expect(merged.reparsed.childCount).toBe(1);
    expect(merged.reparsed.firstChild!.attrs.order).toBe(3);
    expect(merged.reparsed.textContent).toBe("threefouronetwo");
  });

  it("documents the setext heading content loss at parse time", () => {
    // The setext heading's text spans two lines, so the parsed heading would
    // contain a hard break. The heading schema forbids it, and the parser
    // discards the invalid node, leaving only an empty paragraph: the source
    // text is lost before any serialization happens.
    const doc = parse("a\nb\n===");
    expect(doc.textContent).toBe("");
    expect(doc.toJSON()).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(toDraft(doc).text).toBe("");
  });

  it("is stable under serialize, parse, serialize, except for the documented instabilities", () => {
    const unstable: string[] = [];
    for (const [name, doc] of corpus) {
      const { draft, again } = roundTrip(doc);
      const sameSkills = JSON.stringify(again.skills) === JSON.stringify(draft.skills);
      if (again.text !== draft.text || !sameSkills) unstable.push(name);
    }
    expect(unstable.toSorted()).toEqual([...KNOWN_UNSTABLE].toSorted());
  });

  it("keeps skill mentions and offsets through a round trip", () => {
    for (const [name, doc] of corpus) {
      if (!/skill|mention|placeholder/.test(name)) continue;
      const { draft, again } = roundTrip(doc);
      expect(again).toEqual(draft);
    }
  });

  it("writes the composer's conventions", () => {
    expect(toDraft(parse("- one\n- two")).text).toBe("- one\n- two");
    expect(toDraft(parse("Title\n===")).text).toBe("# Title");
    expect(toDraft(parse("a\nb")).text).toBe("a\nb");
    expect(toDraft(parse("1) item")).text).toBe("1. item");
    expect(toDraft(parse("~~~\ncode\n~~~")).text).toBe("```\ncode\n```");
    expect(toDraft(parse("* one\n+ two")).text).toBe("- one\n- two");
    expect(toDraft(parse("a ~~b~~ c")).text).toBe("a \\~\\~b\\~\\~ c");
  });

  it("parses every case into a schema-valid document", () => {
    for (const [, doc] of corpus) {
      expect(() => doc.check()).not.toThrow();
    }
  });
});
