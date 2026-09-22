import type { PastePayload, PasteRoute } from "./pasteRoute.ts";

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
export type PasteFixture = {
  readonly name: string;
  /** The app the payload was copied from. */
  readonly source: string;
  readonly payload: PastePayload;
  readonly route: PasteRoute;
  readonly why: string;
};

export const fixtures: readonly PasteFixture[] = [
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
    route: "rich-link",
    why: "The whole payload is one http(s) URL; the chip is deferred, so it stays ordinary text for now.",
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
