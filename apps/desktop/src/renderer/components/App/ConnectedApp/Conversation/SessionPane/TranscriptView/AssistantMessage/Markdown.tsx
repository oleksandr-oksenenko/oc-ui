import { createEffect, createSignal, For, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { CopyCode } from "./Markdown/CopyCode.tsx";
import { renderMarkdownCached } from "./Markdown/markdown.ts";

export type MarkdownProps = {
  readonly annotationBlock?: string;
  readonly text: string;
};

export function Markdown(props: MarkdownProps): JSX.Element {
  let root!: HTMLDivElement;
  const [blocks, setBlocks] = createSignal<{ host: HTMLDivElement; text: string }[]>([]);
  createEffect(() => {
    root.innerHTML = renderMarkdownCached(props.text);
    for (const region of root.querySelectorAll<HTMLElement>("pre, table")) {
      region.tabIndex = 0;
    }
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
