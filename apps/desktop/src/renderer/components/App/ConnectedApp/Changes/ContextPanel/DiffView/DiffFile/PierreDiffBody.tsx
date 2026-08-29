import { FileDiff as PierreFileDiff } from "@pierre/diffs";
import { createEffect, onCleanup } from "solid-js";

import type { DiffRenderData } from "../diff-render-data.ts";

type PierreDiffBodyProps = {
  readonly diff: DiffRenderData;
  readonly path: string;
};

export function PierreDiffBody(props: PierreDiffBodyProps) {
  let host: HTMLDivElement | undefined;
  const renderer = new PierreFileDiff({
    themeType: "dark",
    diffStyle: "unified",
    expandUnchanged: false,
    disableFileHeader: true,
    overflow: "scroll",
    unsafeCSS: `
      :host {
        --diffs-font-size: 12px;
        --diffs-line-height: 18px;
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
  onCleanup(() => renderer.cleanUp());

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
