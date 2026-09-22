import createDOMPurify from "dompurify";

/**
 * The HTML flavor's safety layer. ProseMirror's own clipboard parser still owns
 * tag mapping and schema validation; DOMPurify only enforces which tags and
 * attributes may reach it, so unsafe link and image URIs are dropped before a
 * mark or node can carry them.
 */

// Tags the composer schema can hold, plus the layout wrappers real clipboard
// HTML uses around its text. A tag outside this list keeps its text content
// (DOMPurify's default), so no visible characters are lost with it; the
// wrappers are listed so `data-pm-slice` context survives a ProseMirror paste.
const ALLOWED_TAGS = [
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

// `data-pm-slice` and the other `data-*` attributes stay allowed through
// DOMPurify's default data-attribute policy, so a ProseMirror-to-ProseMirror
// paste keeps its slice context.
const ALLOWED_ATTRIBUTES = ["alt", "href", "src", "title", "start"];

const purifier = createDOMPurify(window);

/**
 * The deepest element nesting the sanitizer will parse. Chromium's own HTML
 * parser flattens documents deeper than 512 elements, and serializing a tree at
 * that depth already costs tens of milliseconds in the test DOM while a much
 * deeper one can exhaust the serializer's call stack. A clipboard payload past
 * this bound is not inspected; the composer's text flavor takes over.
 */
export const MAX_HTML_NESTING = 512;

/**
 * HTML inspection bound, in UTF-16 code units. The sanitizer parses the whole
 * string, so its cost grows with the size; a payload past this bound is refused
 * without parsing. This is also the bound for ProseMirror's direct
 * `transformPastedHTML` hook, which the clipboard reader cannot guard: the
 * sanitizer is the last gate before the schema parser. The composer's text
 * flavor takes over for a refused payload.
 */
export const MAX_HTML_INSPECTION_UNITS = 1_048_576;

const TAG_TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\/?>/g;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Whether the payload nests elements deeper than `limit`. The scan is textual
 * and conservative: it tracks a stack of open tag names so only a closer that
 * matches the innermost open element closes it — unmatched closers and void
 * elements are ignored — and a non-void self-closing spelling (`<div/>`) opens
 * an element, exactly as HTML reads it. Ambiguous markup may over-count;
 * over-counting only sends a payload to the text fallback. The scan never
 * under-counts the opens it can see, and the sanitizer's size and exception
 * guards backstop the rest.
 */
export function exceedsHtmlNesting(html: string, limit = MAX_HTML_NESTING): boolean {
  const open: string[] = [];
  for (const match of html.matchAll(TAG_TOKEN)) {
    const name = match[2]!.toLowerCase();
    if (match[1] === "/") {
      // HTML ignores a closing tag that matches no open element; closing an
      // outer element here would under-count the real nesting.
      if (open[open.length - 1] === name) open.pop();
      continue;
    }
    if (VOID_TAGS.has(name)) continue;
    open.push(name);
    if (open.length > limit) return true;
  }
  return false;
}

/**
 * DOMPurify allows `data:` URIs on media elements by default. A pasted image
 * with an inline payload is not one the editor should carry (it duplicates the
 * clipboard bytes into the draft), so the source is dropped and the image
 * becomes unsupported content instead.
 */
purifier.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "src") return;
  const value = data.attrValue.trim().toLowerCase();
  if (value.startsWith("data:") || value.startsWith("blob:")) data.keepAttr = false;
});

/**
 * Sanitizes the HTML flavor before the schema parser reads it. The default URI
 * policy drops `javascript:`, `file:`, `blob:` and `data:` sources, so a
 * pasted link without an allowed scheme keeps its text and a pasted image
 * without an allowed source is removed instead of rendering broken.
 *
 * A payload over {@link MAX_HTML_INSPECTION_UNITS} or nested past
 * {@link MAX_HTML_NESTING} is refused before parsing, and a sanitizer failure
 * of any kind yields empty markup rather than a thrown error: the composer then
 * inserts its text fallback, so an adversarial paste can never abort the
 * editor's paste handling.
 */
export function sanitizePastedHtml(html: string): string {
  if (html.length > MAX_HTML_INSPECTION_UNITS) return "";
  if (exceedsHtmlNesting(html)) return "";
  try {
    return purifier.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    });
  } catch {
    return "";
  }
}
