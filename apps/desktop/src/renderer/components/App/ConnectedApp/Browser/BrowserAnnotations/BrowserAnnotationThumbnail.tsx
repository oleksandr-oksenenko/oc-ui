import { createMemo, onCleanup } from "solid-js";
import type { BrowserAnnotationDraft } from "../browser-annotations.ts";

export function BrowserAnnotationThumbnail(props: {
  readonly image: BrowserAnnotationDraft["image"];
}) {
  const url = createMemo(() =>
    URL.createObjectURL(new Blob([new Uint8Array(props.image.data)], { type: props.image.mime })),
  );
  onCleanup(() => URL.revokeObjectURL(url()));
  return <img class="browser-annotation-thumb" src={url()} alt="" />;
}
