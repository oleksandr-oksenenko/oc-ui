import DOMPurify from "dompurify";
import { marked } from "marked";

const markdownTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

/** Parses model Markdown and sanitizes the resulting HTML. */
function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, breaks: true });
  return DOMPurify.sanitize(html.trim(), {
    ALLOWED_ATTR: ["alt", "href", "src", "title", "start"],
    ALLOWED_TAGS: markdownTags,
  });
}

type MarkdownCacheLimits = {
  /** Maximum number of retained entries. */
  readonly maxEntries?: number;
  /** Maximum retained source length, in UTF-16 code units. */
  readonly maxSourceLength?: number;
  /** Maximum retained source plus sanitized HTML length, in UTF-16 code units. */
  readonly maxEntryLength?: number;
  /** Maximum retained source plus HTML length across all entries, in UTF-16 code units. */
  readonly maxRetainedLength?: number;
};

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_SOURCE_LENGTH = 64 * 1024;
const DEFAULT_MAX_ENTRY_LENGTH = 256 * 1024;
const DEFAULT_MAX_RETAINED_LENGTH = 1024 * 1024;

type CachedMarkdown = {
  readonly html: string;
  readonly size: number;
};

/**
 * Bounded memoization of sanitized Markdown keyed by the exact source text.
 * The render policy is a module constant, so the source text is the complete
 * key and a changed text always re-renders.
 *
 * `size` counts both the source and the sanitized HTML in UTF-16 code units
 * (`String.length`). A result whose combined size exceeds the per-entry budget
 * is returned but not retained, so one large result cannot flush the rest of
 * the cache. Eviction otherwise removes least-recently-used entries until both
 * the entry count and the retained length are within budget.
 */
export function createMarkdownCache(
  render: (source: string) => string,
  limits: MarkdownCacheLimits = {},
): (source: string) => string {
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxSourceLength = limits.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH;
  const maxEntryLength = limits.maxEntryLength ?? DEFAULT_MAX_ENTRY_LENGTH;
  const maxRetainedLength = limits.maxRetainedLength ?? DEFAULT_MAX_RETAINED_LENGTH;
  const entries = new Map<string, CachedMarkdown>();
  let retainedLength = 0;

  return (source) => {
    if (source.length > maxSourceLength) return render(source);

    const cached = entries.get(source);
    if (cached !== undefined) {
      // Refresh recency so remounting a transcript does not evict its own text.
      entries.delete(source);
      entries.set(source, cached);
      return cached.html;
    }

    const html = render(source);
    const size = source.length + html.length;
    if (size > maxEntryLength || size > maxRetainedLength) return html;

    entries.set(source, { html, size });
    retainedLength += size;
    while (entries.size > maxEntries || retainedLength > maxRetainedLength) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      const evicted = entries.get(oldest);
      entries.delete(oldest);
      retainedLength -= evicted?.size ?? 0;
    }
    return html;
  };
}

export const renderMarkdownCached = createMarkdownCache(renderMarkdown);
