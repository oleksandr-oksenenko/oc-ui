import DOMPurify from "dompurify";
import { marked } from "marked";
import type { JSX } from "solid-js";

export type MarkdownProps = {
  readonly text: string;
};

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

export function Markdown(props: MarkdownProps): JSX.Element {
  return <div class="transcript-markdown" innerHTML={renderMarkdown(props.text)} />;
}

function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, breaks: true });
  return DOMPurify.sanitize(html.trim(), {
    ALLOWED_ATTR: ["alt", "href", "src", "title"],
    ALLOWED_TAGS: markdownTags,
  });
}
