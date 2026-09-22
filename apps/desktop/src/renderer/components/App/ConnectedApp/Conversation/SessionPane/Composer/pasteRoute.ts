/**
 * Content-aware paste routing for the session composer. Pure and DOM-free: it
 * reads the clipboard formats a source provided and decides which insertion
 * policy the composer should use. Reading the clipboard, applying the decision
 * and owning any attachment stay outside this module.
 *
 * The policy is conservative: a payload is treated as markup only when the
 * evidence is explicit. Ambiguous prose, terminal output, JSON and source code
 * fall back to `plain-text`, which never reinterprets characters. Markdown
 * detection therefore requires either one strong structural signal or two weak
 * inline signals.
 */

export type PasteRoute =
  /** Files on the clipboard become composer attachments. */
  | "attachment-files"
  /** Text too large to edit inline becomes a file-backed text attachment. */
  | "attachment-text"
  /** A lone URL stays ordinary text; rich-link chips remain deferred. */
  | "rich-link"
  /** Parse `text/html` with the schema's clipboard pipeline. */
  | "html-parse"
  /** Parse `text/plain` as draft Markdown. */
  | "markdown-parse"
  /** Insert text as-is, preserving line breaks, without Markdown parsing. */
  | "plain-text"
  /** Insert text verbatim, ignoring every other format (explicit or code context). */
  | "literal"
  /** Nothing to insert; the paste must not replace the selection. */
  | "noop";

type PasteFile = {
  readonly name?: string;
  readonly type?: string;
};

export type PastePayload = {
  /** The effective plain text: `text/plain`, or the HTML flavor's text when absent. */
  readonly text?: string;
  /** `text/html` clipboard data, absent when the format is missing or unbounded. */
  readonly html?: string;
  /** File metadata (`clipboardData.files`); bytes stay outside the classifier. */
  readonly files?: readonly PasteFile[];
  /** Set by the paste-literal gesture (binding owned by the composer). */
  readonly literal?: boolean;
  /** The caret sits in a code block, where every paste is implicitly literal. */
  readonly codeBlock?: boolean;
  /** The HTML flavor was present but exceeded the inspection bound. */
  readonly htmlOversize?: boolean;
};

type PasteReason =
  | "literal-gesture"
  | "code-block"
  | "files-present"
  | "empty-payload"
  | "unsupported-html"
  | "html-inspection-limit"
  | "oversize-text"
  | "lone-url"
  | "rich-html"
  | "markdown-signals"
  | "plain-text";

export type PasteDecision = {
  readonly route: PasteRoute;
  readonly reason: PasteReason;
  /** Matched Markdown signals, in detector order; empty for other routes. */
  readonly signals: readonly string[];
};

/**
 * Text at or above this many UTF-16 code units (16 KiB) becomes a file-backed
 * text attachment instead of inline content. A 50 KB prose paste is roughly
 * three times the limit; one screen of terminal output is far below it. It is
 * an inclusive routing threshold, not the attachment byte cap.
 */
export const TEXT_ATTACHMENT_LIMIT = 16_384;

/** Total Markdown signal weight needed before the text is parsed as Markdown. */
export const MARKDOWN_ROUTE_SCORE = 2;

const HTML_TAG = /<[a-z][^>]*>/i;
// Block-level tags mean the HTML is more than an inline wrapper (a copied link
// or a styled text run), so its structure should be kept.
const HTML_BLOCK_TAG =
  /<(?:p|div|ul|ol|li|h[1-6]|article|section|blockquote|pre|table|tr|td|th)\b/i;
const LONE_URL = /^https?:\/\/\S+$/i;

const MARKDOWN_SIGNALS = [
  { name: "fence", weight: 2, test: /^ {0,3}(`{3,}|~{3,})/ },
  { name: "heading", weight: 2, test: /^ {0,3}#{1,6}(?:[ \t]|$)/ },
  { name: "list-item", weight: 2, test: /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/ },
  { name: "blockquote", weight: 2, test: /^ {0,3}>/ },
  { name: "link", weight: 2, test: /\[[^\]\n]+\]\([^()\s]+\)/ },
  { name: "strong", weight: 2, test: /(?:\*\*|__)(?=\S)[^\n]*?\S(?:\*\*|__)/ },
  { name: "code-span", weight: 1, test: /`[^`\n]+`/ },
  {
    name: "emphasis",
    weight: 1,
    test: /(?<![\w*])\*[^\s*](?:[^*\n]*[^\s*])?\*(?![\w*])/,
  },
  {
    name: "underscore-emphasis",
    weight: 1,
    test: /(?<![\w_])_[^\s_](?:[^_\n]*[^\s_])?_(?![\w_])/,
  },
  { name: "thematic-break", weight: 1, test: /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/ },
] as const;

const MARKDOWN_LINE_SIGNALS = new Set([
  "fence",
  "heading",
  "list-item",
  "blockquote",
  "thematic-break",
]);

/** Markdown signals whose match is meaningful only at the start of a line. */
export function markdownSignals(text: string): readonly string[] {
  const lines = text.split(/\r?\n/);
  return MARKDOWN_SIGNALS.filter((signal) =>
    MARKDOWN_LINE_SIGNALS.has(signal.name)
      ? lines.some((line) => signal.test.test(line))
      : signal.test.test(text),
  ).map((signal) => signal.name);
}

/** Total weight of the matched signals; Markdown needs at least one strong or two weak. */
export function markdownScore(signals: readonly string[]): number {
  return signals.reduce(
    (total, name) => total + (MARKDOWN_SIGNALS.find((signal) => signal.name === name)?.weight ?? 0),
    0,
  );
}

/** HTML worth parsing: it has tags and at least one block-level element. */
export function isRichHtml(html: string | undefined): boolean {
  const value = html?.trim() ?? "";
  return value !== "" && HTML_TAG.test(value) && HTML_BLOCK_TAG.test(value);
}

/**
 * The route a text flavor takes when the HTML flavor could not be used: the
 * HTML fallback rule, stated once. Blank text has no fallback insertion, so it
 * stays a no-op; otherwise Markdown needs the same evidence the classifier
 * demands on its own.
 */
export function textFallbackRoute(text: string): "markdown-parse" | "plain-text" | "noop" {
  if (text.trim() === "") return "noop";
  const signals = markdownSignals(text);
  return markdownScore(signals) >= MARKDOWN_ROUTE_SCORE ? "markdown-parse" : "plain-text";
}

/**
 * Decides the route for one paste payload. Precedence is deliberate:
 *
 * 1. files keep the existing attachment behavior;
 * 2. an explicit literal gesture, then a code block, preserve the text exactly;
 * 3. a payload with no usable text and no rich HTML does nothing, so it can no
 *    longer replace the selection with an empty slice;
 * 4. text over the routing threshold becomes a file-backed text attachment,
 *    whether or not it also has an HTML flavor;
 * 5. rich HTML is parsed with the schema's clipboard pipeline;
 * 6. Markdown is parsed only with enough signal evidence;
 * 7. everything else is inserted literally.
 */
export function classifyPaste(payload: PastePayload): PasteDecision {
  if ((payload.files?.length ?? 0) > 0) {
    return { route: "attachment-files", reason: "files-present", signals: [] };
  }
  if (payload.literal === true) {
    return { route: "literal", reason: "literal-gesture", signals: [] };
  }
  if (payload.codeBlock === true) {
    return { route: "literal", reason: "code-block", signals: [] };
  }
  const text = payload.text ?? "";
  const html = payload.html ?? "";
  // No usable text and no rich structure: nothing to insert. The check is on
  // the payload's usable content, so a tag-less HTML flavor cannot turn an
  // empty paste into a selection-replacing one.
  if (text.trim() === "" && !isRichHtml(html)) {
    if (payload.htmlOversize === true) {
      return { route: "noop", reason: "html-inspection-limit", signals: [] };
    }
    // An HTML flavor that is present but carries no usable text is its own
    // failure: the composer explains it instead of silently doing nothing.
    if (html.trim() !== "") {
      return { route: "noop", reason: "unsupported-html", signals: [] };
    }
    return { route: "noop", reason: "empty-payload", signals: [] };
  }
  if (text.length >= TEXT_ATTACHMENT_LIMIT) {
    return { route: "attachment-text", reason: "oversize-text", signals: [] };
  }
  const trimmed = text.trim();
  if (LONE_URL.test(trimmed) && !isRichHtml(html)) {
    return { route: "rich-link", reason: "lone-url", signals: [] };
  }
  if (isRichHtml(html)) {
    return { route: "html-parse", reason: "rich-html", signals: [] };
  }
  const signals = markdownSignals(text);
  if (markdownScore(signals) >= MARKDOWN_ROUTE_SCORE) {
    return { route: "markdown-parse", reason: "markdown-signals", signals };
  }
  return { route: "plain-text", reason: "plain-text", signals };
}
