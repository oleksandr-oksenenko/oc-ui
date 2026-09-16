import type { PromptFileAttachment } from "@opencode/client";
import { CloseButton, Content, Overlay, Portal, Root, Title, Trigger } from "@kobalte/core/dialog";
import { Icon } from "@opencode/ui/icon";
import { Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js";

import "./ImagePreview.css";

const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

/** Whether a locally attached file can render as an image thumbnail. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (file.type === "" && IMAGE_EXTENSION.test(file.name));
}

/**
 * Renderable source for an image stored on a user message, or undefined for
 * other files. The reader cannot load the connected server's filesystem, so the
 * stored inline bytes are the only reliable source for a remote attachment.
 */
export function promptFileImageSource(file: PromptFileAttachment): string | undefined {
  if (!file.mime.startsWith("image/")) return undefined;
  return `data:${file.mime};base64,${file.data}`;
}

type ImagePreviewSource =
  | { readonly src: string; readonly file?: never }
  | { readonly file: File; readonly src?: never };

export type ImagePreviewProps = ImagePreviewSource & {
  readonly alt: string;
  /** Extra class for the thumbnail button; callers size the thumbnail here. */
  readonly class?: string;
  /** Extra class for the thumbnail image, for callers that target it directly. */
  readonly imageClass?: string;
};

/**
 * A thumbnail that enlarges its image into a modal preview. The preview is a
 * controlled Kobalte dialog, so it owns focus containment, background
 * isolation, and Escape dismissal without depending on the app dialog provider.
 */
export function ImagePreview(props: ImagePreviewProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const source = createMemo(() => {
    if (props.file === undefined) return props.src;
    const url = URL.createObjectURL(props.file);
    onCleanup(() => URL.revokeObjectURL(url));
    return url;
  });

  return (
    <Root modal open={open()} onOpenChange={setOpen}>
      <Trigger
        class={`image-preview-thumbnail${props.class ? ` ${props.class}` : ""}`}
        aria-label={`Enlarge ${props.alt}`}
      >
        <img class={props.imageClass} src={source()} alt={props.alt} loading="lazy" />
      </Trigger>
      <Portal>
        <Overlay class="image-preview-overlay" />
        <Content
          class="image-preview-content"
          aria-modal="true"
          onClick={(event) => {
            // Kobalte owns the modal pointer layer on Content, so the backdrop
            // lives here; only a click on the empty area dismisses.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <Title class="sr-only">{`Preview of ${props.alt}`}</Title>
          <Show when={open()}>
            <img class="image-preview-image" src={source()} alt={props.alt} />
            <CloseButton class="image-preview-close" aria-label="Close image preview">
              <Icon name="close" size="small" aria-hidden="true" />
            </CloseButton>
          </Show>
        </Content>
      </Portal>
    </Root>
  );
}
