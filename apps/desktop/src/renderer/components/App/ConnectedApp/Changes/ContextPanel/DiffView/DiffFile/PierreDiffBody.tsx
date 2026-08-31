import { FileDiff as PierreFileDiff } from "@pierre/diffs";
import type { PostRenderPhase } from "@pierre/diffs";
import { createEffect, onCleanup } from "solid-js";

import type { DiffRenderData } from "../diff-render-data.ts";

type PierreDiffBodyProps = {
  readonly diff: DiffRenderData;
  readonly path: string;
};

function enhanceRenderedDiff(node: HTMLElement, phase: PostRenderPhase): void {
  if (phase === "unmount") return;
  const shadow = node.shadowRoot;
  if (!shadow) return;

  for (const code of shadow.querySelectorAll<HTMLElement>("code[data-code]")) {
    code.tabIndex = 0;
  }

  for (const button of shadow.querySelectorAll<HTMLElement>("[data-expand-button]")) {
    const label = button.hasAttribute("data-expand-all-button")
      ? "Expand all unchanged lines"
      : (() => {
          const direction = button.hasAttribute("data-expand-up")
            ? "above"
            : button.hasAttribute("data-expand-down")
              ? "below"
              : "above and below";
          return `Expand unchanged lines ${direction}`;
        })();
    button.setAttribute("aria-label", label);
    button.tabIndex = 0;
    if (button.dataset.ocuiKeyboardEnabled === "true") continue;
    button.dataset.ocuiKeyboardEnabled = "true";
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      button.click();
    });
  }
}

export function PierreDiffBody(props: PierreDiffBodyProps) {
  let host: HTMLDivElement | undefined;
  const renderer = new PierreFileDiff({
    theme: "github-dark-high-contrast",
    themeType: "dark",
    diffStyle: "unified",
    expandUnchanged: false,
    disableFileHeader: true,
    overflow: "scroll",
    onPostRender: (node, _instance, phase) => enhanceRenderedDiff(node, phase),
    unsafeCSS: `
      :host {
        --diffs-font-size: 12px;
        --diffs-line-height: 18px;
      }

      code[data-code]:focus-visible {
        outline: 2px solid #74a7ff;
        outline-offset: -2px;
      }
    `,
  });

  createEffect(() => {
    if (!host) return;
    const diff = props.diff;
    renderer.render(
      diff.kind === "files"
        ? { oldFile: diff.oldFile, newFile: diff.newFile, containerWrapper: host }
        : { fileDiff: diff.fileDiff, containerWrapper: host },
    );
  });
  onCleanup(() => {
    renderer.cleanUp();
  });

  return (
    <div
      class="pierre-diff-host"
      role="region"
      aria-label={`Changes in ${props.path}`}
      ref={(element) => {
        host = element;
      }}
    />
  );
}
