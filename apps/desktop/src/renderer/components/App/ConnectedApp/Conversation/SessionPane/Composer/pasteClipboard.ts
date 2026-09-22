import {
  collectTransferFiles,
  type FileTransferLike,
} from "../../../../../../opencode/attachments.ts";
import { MAX_HTML_NESTING, exceedsHtmlNesting } from "./pasteHtml.ts";
import { TEXT_ATTACHMENT_LIMIT } from "./pasteRoute.ts";

/**
 * The text flavor reading stage. It sits between the browser's clipboard and
 * the router: the clipboard has no pre-read size metadata, so this module
 * inspects the available types first, bounds every string immediately after
 * acquisition, and derives the effective text before classification.
 */

/**
 * HTML inspection bound, in UTF-16 code units. Parsing cost grows with the
 * string, so the HTML flavor has its own bound instead of sharing the routing
 * threshold or the attachment byte cap. HTML beyond it is not parsed; the text
 * flavor (when present) still routes normally.
 */
export const MAX_HTML_INSPECTION_UNITS = 1_048_576;

const uriListToText = (value: string): string => value.replace(/\r?\n/g, " ");

const BLOCK_TAGS = new Set([
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
 * Nesting deeper than {@link MAX_HTML_NESTING} keeps its text content instead
 * of recursing further, so the derivation cannot exhaust the call stack.
 */
export function htmlToPlainText(html: string): string {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const render = (node: Node, depth: number): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!isElementNode(node)) return "";
    const tag = node.tagName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE") return "";
    if (tag === "BR") return "\n";
    if (depth >= MAX_HTML_NESTING) return node.textContent ?? "";
    const inner = Array.from(node.childNodes, (child) => render(child, depth + 1)).join("");
    return BLOCK_TAGS.has(tag) ? `\n\n${inner}\n\n` : inner;
  };
  const raw = Array.from(dom.body.childNodes, (node) => render(node, 0)).join("");
  return raw.replace(/\n{3,}/g, "\n\n").trim();
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
  /** Bounded `text/html`, absent when the format is missing or over a bound. */
  readonly html?: string;
  /** `text/html` was present but exceeded a size or nesting inspection bound. */
  readonly htmlOversize?: boolean;
};

/** Whether the payload advertises a format; an absent type list reads everything. */
function hasFlavor(data: ClipboardDataLike, type: string): boolean {
  const types = data.types;
  if (types === undefined) return true;
  return Array.from(types).includes(type);
}

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
 * the routing threshold already becomes an attachment. It is also skipped when
 * it exceeds an inspection bound (size or nesting depth), because parsing it
 * would cost unbounded time. A blank plain flavor falls back to the HTML
 * flavor's derived text so the router and the attachment owner never see an
 * empty payload that carries content.
 */
export function readClipboardText(
  data: ClipboardDataLike,
  context: { readonly codeBlock: boolean },
): ClipboardRead {
  const text = readTextFlavor(data);
  const wantsHtml = !context.codeBlock && text.length < TEXT_ATTACHMENT_LIMIT;
  let html: string | undefined;
  let htmlOversize = false;
  if (wantsHtml && hasFlavor(data, "text/html")) {
    const raw = data.getData?.("text/html") ?? "";
    if (raw !== "") {
      if (raw.length > MAX_HTML_INSPECTION_UNITS || exceedsHtmlNesting(raw)) {
        htmlOversize = true;
      } else {
        html = raw;
      }
    }
  }
  const effective = text.trim() === "" && html !== undefined ? htmlToPlainText(html) : text;
  if (htmlOversize) return { text: effective, htmlOversize };
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
