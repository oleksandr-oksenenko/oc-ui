import { createEffect, onCleanup } from "solid-js";
import { FileDiff as PierreFileDiff } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";

type PierreDiffBodyProps = {
  readonly fileDiff: FileDiffMetadata;
  readonly path: string;
};

export function PierreDiffBody(props: PierreDiffBodyProps) {
  let host: HTMLDivElement | undefined;
  const renderer = new PierreFileDiff({
    themeType: "dark",
    diffStyle: "unified",
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
    renderer.render({ fileDiff: props.fileDiff, containerWrapper: host });
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
