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
 */
export function sanitizePastedHtml(html: string): string {
  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
  });
}
