import { describe, expect, it } from "vite-plus/test";
import { fromDraft, pasteContent, schema, toDraft } from "@oc-ui/prompt-editor";
import { EditorState, TextSelection } from "prosemirror-state";

import { fixtures } from "./paste-fixtures.ts";
import {
  MARKDOWN_ROUTE_SCORE,
  TEXT_ATTACHMENT_LIMIT,
  classifyPaste,
  isRichHtml,
  markdownScore,
  markdownSignals,
  type PastePayload,
} from "./pasteRoute.ts";

const route = (payload: PastePayload) => classifyPaste(payload).route;

/** Pastes text at the end of an empty draft with today's policy. */
function pasteToday(text: string) {
  const doc = fromDraft("");
  const state = EditorState.create({ schema, doc, selection: TextSelection.atEnd(doc) });
  return pasteContent(state, text).doc;
}

describe("paste route fixtures", () => {
  for (const fixture of fixtures) {
    it(`routes ${fixture.name} (${fixture.source}) to ${fixture.route}`, () => {
      const decision = classifyPaste(fixture.payload);
      expect(decision.route).toBe(fixture.route);
      expect(fixture.why.length).toBeGreaterThan(0);
    });
  }

  it("keeps every fixture payload honest", () => {
    // The big prose fixture must actually clear the 50 KB claim and the limit.
    expect(
      fixtures.find((fixture) => fixture.name === "huge-prose")!.payload.text!.length,
    ).toBeGreaterThanOrEqual(50_000);
    // The HTML fixtures keep real structure, and the pairs carry both flavors.
    for (const name of ["vscode-code", "browser-article", "chatgpt-message"]) {
      const fixture = fixtures.find((candidate) => candidate.name === name)!;
      expect(isRichHtml(fixture.payload.html)).toBe(true);
      expect(fixture.payload.text!.length).toBeGreaterThan(0);
    }
  });

  it("does not detect Markdown in prose, terminal output, JSON or code", () => {
    const negatives = [
      fixtures.find((fixture) => fixture.name === "terminal-output")!,
      fixtures.find((fixture) => fixture.name === "json-payload")!,
      fixtures.find((fixture) => fixture.name === "plain-code")!,
      fixtures.find((fixture) => fixture.name === "single-newlines")!,
    ];
    for (const fixture of negatives) {
      const signals = markdownSignals(fixture.payload.text!);
      expect(markdownScore(signals)).toBeLessThan(MARKDOWN_ROUTE_SCORE);
      expect(classifyPaste(fixture.payload).route).toBe("plain-text");
    }
    // The 50 KB prose fixture is also prose, not markup.
    const hugeProse = fixtures.find((fixture) => fixture.name === "huge-prose")!;
    expect(markdownScore(markdownSignals(hugeProse.payload.text!))).toBeLessThan(
      MARKDOWN_ROUTE_SCORE,
    );
  });

  it("classifies a 50 KB prose paste and a 50 KB Markdown paste as text attachments", () => {
    const hugeMarkdown = `# Big document\n\n${"Some prose paragraph.\n\n".repeat(3_000)}`;
    expect(hugeMarkdown.length).toBeGreaterThan(50_000);
    expect(route({ text: hugeMarkdown })).toBe("attachment-text");
    expect(route({ text: hugeMarkdown, html: "<p>Some prose paragraph.</p>" })).toBe(
      "attachment-text",
    );
  });
});

describe("paste route precedence", () => {
  it("keeps files ahead of every text flavor and the code context", () => {
    expect(route({ files: [{ name: "a.ts" }], text: "# heading" })).toBe("attachment-files");
    expect(
      route({ files: [{ name: "shot.png", type: "image/png" }], text: "https://example.com/a" }),
    ).toBe("attachment-files");
    expect(route({ files: [{ name: "a.ts" }], text: "hello", codeBlock: true })).toBe(
      "attachment-files",
    );
  });

  it("inserts code-block text literally, including whitespace and oversized text", () => {
    expect(route({ text: "# heading", codeBlock: true })).toBe("plain-text");
    expect(route({ html: "<p>hello</p>", text: "hello", codeBlock: true })).toBe("plain-text");
    expect(route({ text: "\n\n", codeBlock: true })).toBe("plain-text");
    // A code block keeps its characters instead of becoming an attachment.
    expect(route({ text: "a".repeat(TEXT_ATTACHMENT_LIMIT), codeBlock: true })).toBe("plain-text");
    expect(classifyPaste({ text: "x", codeBlock: true }).reason).toBe("code-block");
  });

  it("makes whitespace-only text a no-op outside code and literal contexts", () => {
    expect(classifyPaste({})).toEqual({
      route: "noop",
      reason: "empty-payload",
      signals: [],
    });
    expect(route({ text: "" })).toBe("noop");
    expect(route({ text: "\n\n\n" })).toBe("noop");
    expect(route({ text: "   ", html: "  " })).toBe("noop");
  });

  it("routes text over the threshold to an attachment before reading HTML", () => {
    const atLimit = "a".repeat(TEXT_ATTACHMENT_LIMIT);
    const belowLimit = "a".repeat(TEXT_ATTACHMENT_LIMIT - 1);
    expect(route({ text: atLimit })).toBe("attachment-text");
    expect(route({ text: belowLimit })).toBe("plain-text");
    // Oversized text becomes an attachment even when the payload also carries
    // Markdown or HTML flavors: the threshold is decided before parsing.
    expect(route({ text: `# ${atLimit}`, html: "<article><p>rich</p></article>" })).toBe(
      "attachment-text",
    );
    expect(classifyPaste({ text: atLimit }).reason).toBe("oversize-text");
  });

  it("counts the threshold in UTF-16 code units, not code points", () => {
    // A surrogate pair is two units; 8,192 emoji are exactly 16,384 units.
    const pairs = "😀".repeat(8_192);
    expect(pairs.length).toBe(TEXT_ATTACHMENT_LIMIT);
    expect(route({ text: pairs })).toBe("attachment-text");
    // 16,383 units stay inline even though they carry fewer code points.
    expect(route({ text: "😀".repeat(8_191) })).toBe("plain-text");
    // Mixed text at the boundary is counted the same way.
    expect(route({ text: "a".repeat(TEXT_ATTACHMENT_LIMIT - 2) + "😀" })).toBe("attachment-text");
    expect(route({ text: "a".repeat(TEXT_ATTACHMENT_LIMIT - 3) + "😀" })).toBe("plain-text");
  });

  it("reports HTML that exceeded the size bound when there is no usable text", () => {
    const decision = classifyPaste({ htmlTooLarge: true });
    expect(decision.route).toBe("noop");
    expect(decision.reason).toBe("html-too-large");
    // A usable text flavor still routes normally when the HTML was skipped.
    expect(classifyPaste({ htmlTooLarge: true, text: "- one\n- two" }).route).toBe(
      "markdown-parse",
    );
  });
});

describe("paste route edge cases", () => {
  it("falls back to the text flavor when text/html is empty", () => {
    expect(route({ text: "- one\n- two", html: "" })).toBe("markdown-parse");
    expect(route({ text: "first\nsecond", html: "   " })).toBe("plain-text");
    expect(route({ text: "https://example.com/x", html: "" })).toBe("plain-text");
  });

  it("parses HTML when there is no plain text flavor", () => {
    expect(route({ html: "<p>hello</p>" })).toBe("html-parse");
    expect(route({ html: "<meta charset='utf-8'><span>hi</span>" })).toBe("noop");
    // The router receives HTML-derived text for a block-flavored payload, so
    // the derived characters, not the tags, decide the route.
    expect(route({ html: "<p>hello</p>", text: "hello" })).toBe("html-parse");
  });

  it("treats text/html without tags as plain text", () => {
    expect(route({ text: "hello", html: "hello" })).toBe("plain-text");
    expect(route({ text: "hello", html: "&lt;p&gt;hello&lt;/p&gt;" })).toBe("plain-text");
  });

  it("keeps a lone URL as ordinary text", () => {
    expect(route({ text: "https://example.com/a" })).toBe("plain-text");
    expect(route({ text: "  https://example.com/a  " })).toBe("plain-text");
    expect(route({ text: "https://example.com/a see this" })).toBe("plain-text");
    expect(route({ text: "see https://example.com/a" })).toBe("plain-text");
    expect(route({ text: "ftp://example.com/a" })).toBe("plain-text");
    expect(route({ text: "www.example.com/a" })).toBe("plain-text");
  });

  it("prefers rich HTML over a lone URL serialization", () => {
    expect(
      route({
        text: "https://example.com/a",
        html: '<article><p><a href="https://example.com/a">Example</a></p></article>',
      }),
    ).toBe("html-parse");
    // A bare anchor is not richer than the URL itself, so the text stays text.
    expect(
      route({ text: "https://example.com/a", html: '<a href="https://example.com/a">Example</a>' }),
    ).toBe("plain-text");
  });

  it("needs one strong or two weak Markdown signals", () => {
    expect(route({ text: "# heading" })).toBe("markdown-parse");
    expect(route({ text: "- item" })).toBe("markdown-parse");
    expect(route({ text: "> quote" })).toBe("markdown-parse");
    expect(route({ text: "```\ncode\n```" })).toBe("markdown-parse");
    expect(route({ text: "**bold**" })).toBe("markdown-parse");
    expect(route({ text: "[a](https://example.com)" })).toBe("markdown-parse");
    // Weak signals alone do not parse: `x` and *x* appear in ordinary prose.
    expect(route({ text: "`pnpm check`" })).toBe("plain-text");
    expect(route({ text: "the *items* here" })).toBe("plain-text");
    expect(route({ text: "a `b` and *c*" })).toBe("markdown-parse");
    // Underscores inside identifiers are not emphasis.
    expect(route({ text: "const snake_case_name = 1;" })).toBe("plain-text");
  });

  it("routes the classifier through signals that stay debuggable", () => {
    const decision = classifyPaste({ text: "# heading\n\n- item" });
    expect(decision.reason).toBe("markdown-signals");
    expect(decision.signals).toEqual(["heading", "list-item"]);
  });
});

describe("delta against today's pasteContent", () => {
  it("today parses HTML-bearing pastes from the plain serialization", () => {
    const article = fixtures.find((fixture) => fixture.name === "browser-article")!;
    const doc = pasteToday(article.payload.text!);
    const blocks: string[] = [];
    doc.forEach((node) => blocks.push(node.type.name));
    // The plain article serialization is one paragraph with hard breaks:
    // no heading, no list and no link survive.
    expect(blocks).toEqual(["paragraph"]);
    expect(doc.firstChild!.textContent).toContain("clipboard specification");
    let links = 0;
    doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === "link")) links += 1;
      return true;
    });
    expect(links).toBe(0);
    // The new route keeps the HTML structure instead.
    expect(route(article.payload)).toBe("html-parse");
  });

  it("today interprets lone inline markers that the conservative policy keeps literal", () => {
    const items = pasteToday("the *items* here");
    expect(items.firstChild!.child(1).marks.map((mark) => mark.type.name)).toContain("em");
    expect(route({ text: "the *items* here" })).toBe("plain-text");

    const code = pasteToday("`code`");
    expect(code.firstChild!.firstChild!.marks.map((mark) => mark.type.name)).toContain("code");
    expect(route({ text: "`code`" })).toBe("plain-text");
  });

  it("today lets a whitespace-only paste replace the selection", () => {
    const doc = fromDraft("keep this");
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    expect(toDraft(pasteContent(state, "\n\n\n").doc).text).toBe("");
    // The new route has no insertion for an empty payload; the router's
    // empty-payload decision is a no-op instead.
    expect(classifyPaste({ text: "\n\n\n" }).reason).toBe("empty-payload");
  });

  it("today inserts oversized text and a lone URL as inline content", () => {
    const huge = fixtures.find((fixture) => fixture.name === "huge-prose")!;
    expect(toDraft(pasteToday(huge.payload.text!)).text).toBe(huge.payload.text);
    expect(route(huge.payload)).toBe("attachment-text");

    const url = fixtures.find((fixture) => fixture.name === "lone-url")!;
    expect(toDraft(pasteToday(url.payload.text!)).text).toBe(url.payload.text);
    expect(route(url.payload)).toBe("plain-text");
  });
});
