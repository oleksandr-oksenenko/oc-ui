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

const TAG_TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>/g;

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
 * and conservative: it stops at the first excess, counts every non-void open
 * tag (including self-closing spellings, which HTML treats as open), and may
 * over-count markup inside attribute values. Over-counting only sends a
 * payload to the text fallback; the sanitizer's exception guard backstops any
 * under-count.
 */
export function exceedsHtmlNesting(html: string, limit = MAX_HTML_NESTING): boolean {
  let depth = 0;
  for (const match of html.matchAll(TAG_TOKEN)) {
    if (match[1] === "/") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (VOID_TAGS.has(match[2]!.toLowerCase())) continue;
    depth += 1;
    if (depth > limit) return true;
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
 * A payload nested past {@link MAX_HTML_NESTING} is refused before parsing, and
 * a sanitizer failure of any kind yields empty markup rather than a thrown
 * error: the composer then inserts its text fallback, so an adversarial paste
 * can never abort the editor's paste handling.
 */
export function sanitizePastedHtml(html: string): string {
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
