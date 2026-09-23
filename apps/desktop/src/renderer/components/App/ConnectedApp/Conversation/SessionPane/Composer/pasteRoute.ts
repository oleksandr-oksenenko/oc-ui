/**
 * Content-aware paste routing for the session composer. Pure and DOM-free: it
 * reads the text a source provided and decides which insertion policy the
 * composer should use. Reading the clipboard, applying the decision and owning
 * any attachment stay outside this module.
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
  /** Parse `text/plain` as draft Markdown. */
  | "markdown-parse"
  /** Insert text as-is, preserving line breaks, without Markdown parsing. */
  | "plain-text"
  /** Nothing to insert; the paste must not replace the selection. */
  | "noop";

type PasteFile = {
  readonly name?: string;
  readonly type?: string;
};

export type PastePayload = {
  /** The plain text the clipboard carries; absent when it has no text flavor. */
  readonly text?: string;
  /** File metadata (`clipboardData.files`); bytes stay outside the classifier. */
  readonly files?: readonly PasteFile[];
  /** The caret sits in a code block, where every paste is implicitly literal. */
  readonly codeBlock?: boolean;
};

type PasteReason =
  | "code-block"
  | "files-present"
  | "empty-payload"
  | "oversize-text"
  | "markdown-signals"
  | "plain-text";

export type PasteDecision = {
  readonly route: PasteRoute;
  /** Set where composer feedback or diagnostics distinguish one route from another. */
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
const MARKDOWN_ROUTE_SCORE = 2;

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
function markdownSignals(text: string): readonly string[] {
  const lines = text.split(/\r?\n/);
  return MARKDOWN_SIGNALS.filter((signal) =>
    MARKDOWN_LINE_SIGNALS.has(signal.name)
      ? lines.some((line) => signal.test.test(line))
      : signal.test.test(text),
  ).map((signal) => signal.name);
}

/** Total weight of the matched signals; Markdown needs at least one strong or two weak. */
function markdownScore(signals: readonly string[]): number {
  return signals.reduce(
    (total, name) => total + (MARKDOWN_SIGNALS.find((signal) => signal.name === name)?.weight ?? 0),
    0,
  );
}

/**
 * Decides the route for one paste payload. Precedence is deliberate:
 *
 * 1. files keep the existing attachment behavior;
 * 2. a code block inserts its text exactly, whatever it looks like and however
 *    large it is (an attachment would replace its characters);
 * 3. a whitespace-only payload does nothing, so it can no longer replace the
 *    selection with an empty slice;
 * 4. text over the routing threshold becomes a file-backed text attachment;
 * 5. Markdown is parsed only with enough signal evidence;
 * 6. everything else is inserted literally, plain text and lone URLs alike.
 */
export function classifyPaste(payload: PastePayload): PasteDecision {
  if ((payload.files?.length ?? 0) > 0) {
    return { route: "attachment-files", reason: "files-present", signals: [] };
  }
  const text = payload.text ?? "";
  if (payload.codeBlock === true && text !== "") {
    return { route: "plain-text", reason: "code-block", signals: [] };
  }
  // No usable text: nothing to insert, so a payload with only unsupported
  // flavors cannot turn an empty paste into a selection-replacing one.
  if (text.trim() === "") {
    return { route: "noop", reason: "empty-payload", signals: [] };
  }
  if (text.length >= TEXT_ATTACHMENT_LIMIT) {
    return { route: "attachment-text", reason: "oversize-text", signals: [] };
  }
  const signals = markdownSignals(text);
  if (markdownScore(signals) >= MARKDOWN_ROUTE_SCORE) {
    return { route: "markdown-parse", reason: "markdown-signals", signals };
  }
  return { route: "plain-text", reason: "plain-text", signals };
}
