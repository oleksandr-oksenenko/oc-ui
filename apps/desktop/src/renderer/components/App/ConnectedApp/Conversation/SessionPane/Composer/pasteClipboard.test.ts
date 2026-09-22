import { describe, expect, it } from "vite-plus/test";

import { htmlToPlainText, readClipboardFiles, readClipboardText } from "./pasteClipboard.ts";
import { MAX_HTML_INSPECTION_UNITS, MAX_HTML_NESTING } from "./pasteHtml.ts";

/** A clipboard whose `types` match the provided flavors unless overridden. */
const clipboard = (
  data: Readonly<Record<string, string>>,
  types: readonly string[] = Object.keys(data),
) => ({
  files: [],
  types,
  getData: (type: string) => data[type] ?? "",
});

const context = { codeBlock: false };

describe("readClipboardText", () => {
  it("reads the plain flavor and leaves the HTML flavor untouched for parsing", () => {
    const read = readClipboardText(
      clipboard({ "text/plain": "hello", "text/html": "<p>hello</p>" }),
      context,
    );
    expect(read).toEqual({ text: "hello", html: "<p>hello</p>" });
  });

  it("falls back to the URI list with line feeds flattened, then to the legacy Text spelling", () => {
    expect(
      readClipboardText(clipboard({ "text/uri-list": "https://example.com/a\r\n" }), context).text,
    ).toBe("https://example.com/a ");
    expect(readClipboardText(clipboard({ Text: "legacy" }), context).text).toBe("legacy");
    // A nonempty plain flavor always wins over the fallbacks.
    expect(
      readClipboardText(
        clipboard({ "text/plain": "plain", "text/uri-list": "https://example.com/a" }),
        context,
      ).text,
    ).toBe("plain");
  });

  it("does not read the HTML flavor when it cannot win", () => {
    const flavors = { "text/plain": "hello", "text/html": "<p>hello</p>" };
    expect(readClipboardText(clipboard(flavors), { codeBlock: true }).html).toBe(undefined);
    // Oversized text already routes to an attachment, so HTML is not read.
    const huge = "a".repeat(16_384);
    const read = readClipboardText(
      clipboard({ "text/plain": huge, "text/html": "<p>rich</p>" }),
      context,
    );
    expect(read.html).toBe(undefined);
    expect(read.text).toBe(huge);
  });

  it("bounds HTML separately and reports when it was skipped", () => {
    const overBound = `<p>${"a".repeat(MAX_HTML_INSPECTION_UNITS)}</p>`;
    const read = readClipboardText(
      clipboard({ "text/html": overBound, "text/plain": "fallback" }),
      context,
    );
    expect(read.html).toBe(undefined);
    expect(read.htmlOversize).toBe(true);
    // The text flavor still routes normally.
    expect(read.text).toBe("fallback");

    const atBound = `<p>${"a".repeat(MAX_HTML_INSPECTION_UNITS - 7)}</p>`;
    const bounded = readClipboardText(clipboard({ "text/html": atBound }), context);
    expect(bounded.html).toBe(atBound);
    expect(bounded.htmlOversize).toBe(undefined);
  });

  it("does not expose HTML nested past the inspection bound", () => {
    const deep = `${"<div>".repeat(20_000)}<p>hidden</p>${"</div>".repeat(20_000)}`;
    const read = readClipboardText(
      clipboard({ "text/html": deep, "text/plain": "fallback" }),
      context,
    );
    expect(read.html).toBe(undefined);
    expect(read.htmlOversize).toBe(true);
    // The text flavor still routes normally.
    expect(read.text).toBe("fallback");

    // With no plain flavor there is nothing to derive without parsing the
    // deep tree, so the payload is left uninspected instead.
    const blank = readClipboardText(clipboard({ "text/html": deep }), context);
    expect(blank.html).toBe(undefined);
    expect(blank.htmlOversize).toBe(true);
    expect(blank.text).toBe("");
  });

  it("keeps HTML exactly at the nesting bound parseable", () => {
    const atBound = `${"<div>".repeat(MAX_HTML_NESTING)}deep${"</div>".repeat(MAX_HTML_NESTING)}`;
    const read = readClipboardText(clipboard({ "text/html": atBound }), context);
    expect(read.html).toBe(atBound);
    expect(read.htmlOversize).toBe(undefined);
  });

  it("derives the effective text from HTML when the plain flavor is blank", () => {
    const read = readClipboardText(
      clipboard({ "text/plain": "   ", "text/html": "<h1>Title</h1><p>Body text</p>" }),
      context,
    );
    expect(read.text).toBe("Title\n\nBody text");
    expect(read.html).toBe("<h1>Title</h1><p>Body text</p>");
  });

  it("adapts to sources without a type list and to absent getData", () => {
    const data = { files: [], getData: (type: string) => (type === "text/plain" ? "x" : "") };
    expect(readClipboardText(data, context).text).toBe("x");
    expect(readClipboardText({ files: [] }, context)).toEqual({ text: "" });
  });
});

describe("htmlToPlainText", () => {
  it("keeps block and line boundaries without markup", () => {
    expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
    expect(htmlToPlainText("<ul><li>one</li><li>two</li></ul>")).toBe("one\n\ntwo");
    expect(htmlToPlainText("first<br>second")).toBe("first\nsecond");
    expect(htmlToPlainText("<div><span>inline</span> text</div>")).toBe("inline text");
  });

  it("decodes entities and drops script and style content", () => {
    expect(htmlToPlainText("<p>&lt;tag&gt; &amp; more</p>")).toBe("<tag> & more");
    expect(htmlToPlainText("<p>keep</p><script>alert(1)</script><style>p{color:red}</style>")).toBe(
      "keep",
    );
  });

  it("keeps table cell text and survives malformed markup", () => {
    expect(htmlToPlainText("<table><tr><td>a</td><td>b</td></tr></table>")).toBe("a\n\nb");
    expect(htmlToPlainText("<p>unclosed <b>bold")).toBe("unclosed bold");
    expect(htmlToPlainText("")).toBe("");
  });

  it("keeps text from markup nested past the recursion bound", () => {
    const depth = MAX_HTML_NESTING + 5;
    const deep = `${"<div>".repeat(depth)}<p>deep text</p>${"</div>".repeat(depth)}`;
    expect(htmlToPlainText(deep)).toBe("deep text");
  });
});

describe("readClipboardFiles", () => {
  it("collects file metadata without reading bytes", () => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    expect(readClipboardFiles({ files: [file] })).toEqual([file]);
    expect(readClipboardFiles(null)).toEqual([]);
  });
});
