import {
  collectTransferFiles,
  type FileTransferLike,
} from "../../../../../../opencode/attachments.ts";
import { MAX_HTML_INSPECTION_UNITS } from "./pasteHtml.ts";
import { TEXT_ATTACHMENT_LIMIT } from "./pasteRoute.ts";

/**
 * The text flavor reading stage. It sits between the browser's clipboard and
 * the router: the clipboard has no pre-read size metadata, so this module
 * inspects the available types first, bounds every string immediately after
 * acquisition, and derives the effective text before classification.
 */

// Text boundaries only: tags that end one text block and start another during
// extraction. This list is deliberately separate from the sanitizer's
// allowance and from the richness evidence; e.g. `img` is allowed through the
// sanitizer but is not a text boundary, and `form` is a boundary even though
// the schema cannot hold it.
const TEXT_BOUNDARY_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Whether a DOM node is an element; narrows without an unsafe assertion. */
function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * The plain text an HTML payload carries, with block boundaries as blank lines
 * and `<br>` as a line feed. This is a text derivation for the attachment and
 * fallback decisions only; insertion still runs through the schema parser.
 *
 * The walk is iterative, so it stays safe on the deeply nested markup the
 * clipboard reader passes through without a nesting scan, and it skips
 * `script`/`style` subtrees at every depth instead of trusting the text content
 * of a tree too deep to recurse into.
 */
export function htmlToPlainText(html: string): string {
  try {
    const dom = new DOMParser().parseFromString(html, "text/html");
    type Task = { readonly node: Node } | { readonly text: string };
    const output: string[] = [];
    const stack: Task[] = [];
    for (let index = dom.body.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: dom.body.childNodes[index]! });
    }
    while (stack.length > 0) {
      const task = stack.pop()!;
      if ("text" in task) {
        output.push(task.text);
        continue;
      }
      const node = task.node;
      if (node.nodeType === Node.TEXT_NODE) {
        output.push(node.textContent ?? "");
        continue;
      }
      if (!isElementNode(node)) continue;
      const tag = node.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      if (tag === "BR") {
        output.push("\n");
        continue;
      }
      const block = TEXT_BOUNDARY_TAGS.has(tag);
      // Pushed in reverse evaluation order, so the opener is popped first,
      // then the children in document order, then the closer.
      if (block) stack.push({ text: "\n\n" });
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.childNodes[index]! });
      }
      if (block) stack.push({ text: "\n\n" });
    }
    return output
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    // Extraction is best effort: a parser failure yields no text, and the
    // router falls back to the unsupported-content notice instead.
    return "";
  }
}

/**
 * The subset of `DataTransfer` the paste reader needs. A real clipboard always
 * provides `getData` and `types`; tests and odd sources may omit either.
 */
export type ClipboardDataLike = FileTransferLike & {
  readonly getData?: ((type: string) => string) | undefined;
};

export type ClipboardRead = {
  /** The effective text: the plain flavor, or the HTML flavor's derived text. */
  readonly text: string;
  /** Size-bounded `text/html`, absent when the format is missing or too large. */
  readonly html?: string;
  /** `text/html` was present but exceeded the inspection size bound. */
  readonly htmlTooLarge?: true;
};

/** Whether the payload advertises a format; an absent type list reads everything. */
function hasFlavor(data: ClipboardDataLike, type: string): boolean {
  const types = data.types;
  if (types === undefined) return true;
  return Array.from(types).includes(type);
}

const uriListToText = (value: string): string => value.replace(/\r?\n/g, " ");

function readTextFlavor(data: ClipboardDataLike): string {
  const getData = data.getData?.bind(data);
  if (getData === undefined) return "";
  // ProseMirror's own fallback order: `text/plain`, the legacy `Text`
  // spelling, then `text/uri-list` with its line feeds flattened.
  const plain = getData("text/plain") || getData("Text");
  if (plain !== "") return plain;
  const uris = getData("text/uri-list");
  return uris === "" ? "" : uriListToText(uris);
}

/**
 * Reads the text and HTML flavors with the routing context. The HTML flavor is
 * not read when it cannot win: a code-block context ignores it, and text over
 * the routing threshold already becomes an attachment.
 *
 * A size-bounded HTML flavor is passed through whole, however deeply it nests:
 * the sanitizer owns that refusal, and text extraction walks it iteratively. A
 * flavor past the size bound is never handed to `DOMParser` (it parses the
 * whole string before any walker), so it is refused unless the plain flavor
 * can stand in. A blank plain flavor falls back to the HTML flavor's derived
 * text, so the router and the attachment owner never see an empty payload that
 * carries content.
 */
export function readClipboardText(
  data: ClipboardDataLike,
  context: { readonly codeBlock: boolean },
): ClipboardRead {
  const text = readTextFlavor(data);
  const wantsHtml = !context.codeBlock && text.length < TEXT_ATTACHMENT_LIMIT;
  let html: string | undefined;
  let htmlTooLarge = false;
  if (wantsHtml && hasFlavor(data, "text/html")) {
    const raw = data.getData?.("text/html") ?? "";
    if (raw !== "") {
      if (raw.length > MAX_HTML_INSPECTION_UNITS) htmlTooLarge = true;
      else html = raw;
    }
  }
  const effective = text.trim() === "" && html !== undefined ? htmlToPlainText(html) : text;
  if (htmlTooLarge) return { text: effective, htmlTooLarge: true };
  if (html === undefined) return { text: effective };
  return { text: effective, html };
}

/**
 * Collects file attachments from a paste payload. Metadata only: the bytes are
 * never read here, and the existing size policy belongs to the attachment
 * owner.
 */
export function readClipboardFiles(data: ClipboardDataLike | null): File[] {
  return collectTransferFiles(data);
}
