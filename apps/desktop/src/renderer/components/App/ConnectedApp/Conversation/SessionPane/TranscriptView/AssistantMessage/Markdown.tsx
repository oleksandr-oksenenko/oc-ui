import DOMPurify from "dompurify";
import { marked } from "marked";
import { createEffect, createSignal, For, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { CopyCode } from "./Markdown/CopyCode.tsx";

export type MarkdownProps = {
  readonly annotationBlock?: string;
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
  let root!: HTMLDivElement;
  const [blocks, setBlocks] = createSignal<{ host: HTMLDivElement; text: string }[]>([]);
  createEffect(() => {
    root.innerHTML = renderMarkdown(props.text);
    setBlocks(
      [...root.querySelectorAll("pre")].map((pre) => {
        const host = document.createElement("div");
        host.className = "transcript-code-block";
        pre.replaceWith(host);
        host.append(pre);
        return { host, text: pre.textContent ?? "" };
      }),
    );
  });
  return (
    <>
      <div
        ref={(element) => {
          root = element;
        }}
        data-annotation-block={props.annotationBlock}
        class="transcript-markdown"
      />
      <For each={blocks()}>
        {(block) => (
          <Portal mount={block.host}>
            <CopyCode text={block.text} />
          </Portal>
        )}
      </For>
    </>
  );
}

function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, breaks: true });
  return DOMPurify.sanitize(html.trim(), {
    ALLOWED_ATTR: ["alt", "href", "src", "title", "start"],
    ALLOWED_TAGS: markdownTags,
  });
}
