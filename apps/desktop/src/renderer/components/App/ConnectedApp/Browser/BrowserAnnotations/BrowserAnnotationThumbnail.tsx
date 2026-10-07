import { createMemo } from "solid-js";
import { ImagePreview } from "../../../../../ui/ImagePreview.tsx";
import type { BrowserAnnotationDraft } from "../browser-annotations.ts";

export function BrowserAnnotationThumbnail(props: {
  readonly image: BrowserAnnotationDraft["image"];
  readonly number: number;
}) {
  const file = createMemo(
    () =>
      new File([new Uint8Array(props.image.data)], props.image.name, { type: props.image.mime }),
  );
  return (
    <ImagePreview
      file={file()}
      alt={`Browser annotation ${props.number}`}
      class="browser-annotation-preview"
      imageClass="browser-annotation-thumb"
    />
  );
}
