import { describe, expect, it } from "vite-plus/test";

import {
  TEXT_ATTACHMENT_LIMIT,
  classifyPaste,
  type PastePayload,
  type PasteRoute,
} from "./pasteRoute.ts";

/**
 * Hand-written clipboard payloads for the paste router. Each pair mirrors what
 * the named source puts on the macOS/Chromium clipboard: `text/html` is the
 * rich flavor, `text/plain` the fallback serialization. Strings stay small but
 * keep the shapes that matter for routing: token spans and a wrapper `div` for
 * VS Code, `<pre>`/`<p>`/`<li>` for chat messages, marker-free prose for a
 * browser article serialization, a Finder file reference, and so on.
 */

/** VS Code "Copy" of a TypeScript snippet: HTML with token spans + plain code. */
const vscodeCodeHtml = `<meta charset='utf-8'><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569CD6;">const</span><span style="color: #D4D4D4;"> </span><span style="color: #4FC1FF;">total</span><span style="color: #D4D4D4;"> = </span><span style="color: #9CDCFE;">items</span><span style="color: #D4D4D4;">.</span><span style="color: #DCDCAA;">reduce</span><span style="color: #D4D4D4;">((</span><span style="color: #9CDCFE;">sum</span><span style="color: #D4D4D4;">, </span><span style="color: #9CDCFE;">item</span><span style="color: #D4D4D4;">) => </span><span style="color: #9CDCFE;">sum</span><span style="color: #D4D4D4;"> + </span><span style="color: #9CDCFE;">item</span><span style="color: #D4D4D4;">.</span><span style="color: #9CDCFE;">price</span><span style="color: #D4D4D4;">, </span><span style="color: #B5CEA8;">0</span><span style="color: #D4D4D4;">);</span></div><div><span style="color: #D4D4D4;"></span></div><div><span style="color: #6A9955;">// The list is small, so a linear scan is fine.</span></div><div><span style="color: #569CD6;">const</span><span style="color: #D4D4D4;"> </span><span style="color: #4FC1FF;">names</span><span style="color: #D4D4D4;"> = </span><span style="color: #9CDCFE;">items</span><span style="color: #D4D4D4;">.</span><span style="color: #DCDCAA;">map</span><span style="color: #D4D4D4;">((</span><span style="color: #9CDCFE;">item</span><span style="color: #D4D4D4;">) => </span><span style="color: #9CDCFE;">item</span><span style="color: #D4D4D4;">.</span><span style="color: #9CDCFE;">name</span><span style="color: #D4D4D4;">);</span></div></div>`;
const vscodeCodeText = `const total = items.reduce((sum, item) => sum + item.price, 0);

// The list is small, so a linear scan is fine.
const names = items.map((item) => item.name);`;

/** Terminal selection: plain text, no rich flavor, shell prompt included. */
const terminalOutput = `$ pnpm --filter desktop exec tsc -p tsconfig.renderer.json --noEmit
src/renderer/components/App.tsx:42:18 - error TS2322: Type 'string | undefined' is not assignable to type 'string'.

42   <Shell sessionID={sessionID} />
                    ~~~~~~~~~

Found 1 error in 2 files.`;

/** Browser article selection: HTML with headings, links and a list. */
const browserArticleHtml = `<article><h1>Paste routing</h1><p>A paste carries up to three formats. The <a href="https://example.com/spec">clipboard specification</a> does not say which one to prefer.</p><h2>Fallback order</h2><ul><li>Files win over text.</li><li>Rich HTML beats the plain serialization.</li><li>Plain text is the last resort.</li></ul></article>`;
const browserArticleText = `Paste routing
A paste carries up to three formats. The clipboard specification does not say which one to prefer.
Fallback order
Files win over text.
Rich HTML beats the plain serialization.
Plain text is the last resort.`;

/** ChatGPT assistant message: paragraphs, a bold phrase, a list and a code block. */
const chatGptMessageHtml = `<p>There are two ways to read the payload:</p><ul><li><strong>Prefer the richest format</strong> that the schema can hold.</li><li>Fall back to <code>text/plain</code> when the rich format is empty.</li></ul><p>For example:</p><pre><code class="language-ts">const route = classifyPaste(payload);
</code></pre><p>Keep the original text when nothing else applies.</p>`;
const chatGptMessageText = `There are two ways to read the payload:

• Prefer the richest format that the schema can hold.
• Fall back to text/plain when the rich format is empty.

For example:

const route = classifyPaste(payload);

Keep the original text when nothing else applies.`;

/** Markdown source copied from an editor: plain text with structural markers. */
const markdownSource = `# Review checklist

- [ ] Run \`pnpm check\`
- [ ] Run \`pnpm test\`

> Keep the change small and explain any growth.

\`\`\`ts
const route = classifyPaste(payload);
\`\`\`

See [the design doc](https://example.com/design) for **routing rules**.`;

/** A package manifest copied as plain text (no rich flavor). */
const jsonPayload = `{
  "name": "@opencode/desktop",
  "version": "0.1.0",
  "scripts": {
    "check": "vp check",
    "test": "vp test run --passWithNoTests"
  },
  "dependencies": {
    "effect": "4.0.0-rc.112",
    "prosemirror-markdown": "^1.13.2"
  }
}`;

/** Plain source code: block comment, multiplication, division, template string. */
const plainCode = `/* Computes the average price of the selected items. */
function averagePrice(items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const count = items.length / 2;
  return count === 0 ? 0 : total / count;
}

const label = \`\${count} items at \${total} total\`;`;

/** A single URL copied by itself. */
const loneUrl = "https://github.com/anomalyco/opencode/pull/18342";

/** Three lines separated by single newlines, no Markdown syntax. */
const singleNewlines = `first line
second line
third line`;

/** Prose long enough for the file-backed text attachment route (about 51 KB). */
const proseParagraph =
  "A conservative router should only interpret text as markup when the evidence is unambiguous. " +
  "Prose usually contains punctuation, digits and ordinary sentences, but no heading, list, fence or blockquote markers; " +
  "terminal output and source code look similar, so every structural signal has to be anchored to a line start or a paired delimiter. " +
  "When nothing matches, the text is inserted without reinterpreting it, which keeps the pasted characters equal to the clipboard.";
const hugeProse = Array.from(
  { length: 120 },
  (_, index) => `${proseParagraph} (Section ${index + 1}.)`,
).join("\n\n");

/** Finder "Copy" of three selected files: names only, no text flavor. */
const finderFiles = [
  { name: "paste-routing.md" },
  { name: "classify.ts" },
  { name: "Q3 report.pdf" },
] as const;

/** A screenshot on the clipboard: an image file, no text flavor. */
const imageFile = {
  name: "Screenshot 2026-09-22 at 10.14.03.png",
  type: "image/png",
} as const;

/**
 * One clipboard payload plus the route the conservative policy should choose.
 * `why` records the intent so a changed expectation is a deliberate decision
 * rather than a test edit.
 */
type PasteFixture = {
  readonly name: string;
  /** The app the payload was copied from. */
  readonly source: string;
  readonly payload: PastePayload;
  readonly route: PasteRoute;
  readonly why: string;
};

const fixtures: readonly PasteFixture[] = [
  {
    name: "vscode-code",
    source: "VS Code copy of a TypeScript snippet",
    payload: { html: vscodeCodeHtml, text: vscodeCodeText },
    route: "html-parse",
    why: "Token spans and the wrapper div carry the code block and the comment line; the plain fallback loses the block structure.",
  },
  {
    name: "terminal-output",
    source: "Terminal selection",
    payload: { text: terminalOutput },
    route: "plain-text",
    why: "Compiler output has no structural Markdown signal; the underline rule is indented and is not a thematic break.",
  },
  {
    name: "browser-article",
    source: "Browser article selection",
    payload: { html: browserArticleHtml, text: browserArticleText },
    route: "html-parse",
    why: "The HTML keeps the heading levels, the link and the list; the serialization flattened them to lines.",
  },
  {
    name: "chatgpt-message",
    source: "ChatGPT assistant message",
    payload: { html: chatGptMessageHtml, text: chatGptMessageText },
    route: "html-parse",
    why: "Paragraphs, bold text, a bullet list and a fenced code block are all in the HTML flavor.",
  },
  {
    name: "markdown-source",
    source: "Markdown file copied from an editor",
    payload: { text: markdownSource },
    route: "markdown-parse",
    why: "Heading, task list, blockquote, fence, link and strong text are explicit structural evidence.",
  },
  {
    name: "json-payload",
    source: "package.json copied as plain text",
    payload: { text: jsonPayload },
    route: "plain-text",
    why: "JSON braces, quotes and commas are not Markdown signals; no line starts a block or a list.",
  },
  {
    name: "plain-code",
    source: "Source code copied as plain text",
    payload: { text: plainCode },
    route: "plain-text",
    why: "A block comment, a multiplication and a template string are not paired Markdown delimiters.",
  },
  {
    name: "lone-url",
    source: "Copy Link",
    payload: { text: loneUrl },
    route: "plain-text",
    why: "The whole payload is one http(s) URL; without markup evidence it is ordinary text that keeps its characters.",
  },
  {
    name: "huge-prose",
    source: "50 KB prose paste from a document",
    payload: { text: hugeProse },
    route: "attachment-text",
    why: "The text exceeds the 16 KiB inline limit, so it is attached instead of parsed or inserted.",
  },
  {
    name: "single-newlines",
    source: "Three lines copied without formatting",
    payload: { text: singleNewlines },
    route: "plain-text",
    why: "No Markdown signal; the insertion must still keep the three lines by mapping newlines to hard breaks.",
  },
  {
    name: "finder-files",
    source: "Finder copy of selected files",
    payload: { files: finderFiles },
    route: "attachment-files",
    why: "File references are attachments; the composer's capture listener already owns this payload shape.",
  },
  {
    name: "image-note",
    source: "Screenshot on the clipboard",
    payload: { files: [imageFile] },
    route: "attachment-files",
    why: "An image file (no binary needed here) attaches once, exactly like today's capture listener.",
  },
];

const route = (payload: PastePayload) => classifyPaste(payload).route;

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
    // The HTML fixtures carry both flavors and route through the HTML pipeline.
    for (const name of ["vscode-code", "browser-article", "chatgpt-message"]) {
      const fixture = fixtures.find((candidate) => candidate.name === name)!;
      expect(classifyPaste(fixture.payload).route).toBe("html-parse");
      expect(fixture.payload.text!.length).toBeGreaterThan(0);
    }
  });

  it("does not detect Markdown in prose, terminal output, JSON or code", () => {
    // A weak signal alone (the template string's code span) stays below the
    // route threshold; the decision exposes it without parsing the text.
    for (const [name, signals] of [
      ["terminal-output", []],
      ["json-payload", []],
      ["plain-code", ["code-span"]],
      ["single-newlines", []],
    ] as const) {
      const fixture = fixtures.find((candidate) => candidate.name === name)!;
      expect(classifyPaste(fixture.payload)).toEqual({
        route: "plain-text",
        reason: "plain-text",
        signals,
      });
    }
    // The 50 KB prose fixture is prose, not markup: the same text below the
    // attachment threshold routes literally with no signals.
    const prose = fixtures.find((fixture) => fixture.name === "huge-prose")!.payload.text!;
    expect(classifyPaste({ text: prose.slice(0, TEXT_ATTACHMENT_LIMIT - 1) })).toEqual({
      route: "plain-text",
      reason: "plain-text",
      signals: [],
    });
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
