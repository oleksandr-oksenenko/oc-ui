import { Popover } from "@kobalte/core/popover";
import { FileIcon } from "@opencode/ui/file-icon";
import { Icon } from "@opencode/ui/icon";
import { Show, type JSX } from "solid-js";

import { ImagePreview, type ImagePreviewProps, type ImagePreviewSource } from "./ImagePreview.tsx";
import { RemoveButton } from "./RemoveButton.tsx";
import "./AttachmentDetail.css";
import "./AttachmentPills.css";

type Remove = (button: HTMLButtonElement) => void;

export function AttachmentPills(props: {
  readonly children: JSX.Element;
  readonly class?: string;
}) {
  return (
    <div
      class={`attachment-pills${props.class ? ` ${props.class}` : ""}`}
      role="group"
      aria-label="Attachments"
    >
      {props.children}
    </div>
  );
}

type DetailBaseProps = {
  readonly kind: "review" | "annotations" | "browser";
  readonly label: string;
  readonly title: string;
  readonly triggerRef?: (button: HTMLButtonElement) => void;
  readonly onRemove?: Remove;
  readonly removeLabel?: string;
  /** Disables removal while leaving previews readable. */
  readonly disabled?: boolean;
};

type DetailProps = DetailBaseProps &
  (
    | {
        readonly children: JSX.Element;
        readonly onOpen?: never;
        readonly expanded?: never;
        readonly controls?: never;
      }
    | {
        /** An owner may open its existing anchored editor instead of using detail content. */
        readonly onOpen: (opener: HTMLButtonElement) => void;
        readonly children?: never;
        readonly expanded?: boolean;
        readonly controls?: string;
      }
  );

function RemoveAttachment(props: {
  readonly label: string;
  readonly onRemove: Remove;
  /** Disables removal while leaving previews readable. */
  readonly disabled?: boolean;
}) {
  return (
    <RemoveButton
      class="attachment-pill-remove"
      label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={(event) => props.onRemove(event.currentTarget)}
    />
  );
}

const detailIcon = { review: "code", annotations: "comment", browser: "globe" } as const;

export function AttachmentDetailPill(props: DetailProps) {
  return (
    <div class={`attachment-pill attachment-pill-${props.kind}`}>
      <Show
        when={props.onOpen === undefined}
        fallback={
          <button
            ref={(button) => props.triggerRef?.(button)}
            type="button"
            class="attachment-pill-trigger attachment-pill-external"
            aria-expanded={props.expanded}
            aria-controls={props.controls}
            onClick={(event) => props.onOpen?.(event.currentTarget)}
          >
            <Icon name={detailIcon[props.kind]} size="small" aria-hidden="true" />
            <span>{props.label}</span>
          </button>
        }
      >
        <Popover placement="bottom-start" gutter={5} fitViewport>
          <Popover.Trigger
            as="button"
            type="button"
            class="attachment-pill-trigger"
            ref={(button: HTMLButtonElement) => props.triggerRef?.(button)}
          >
            <Icon name={detailIcon[props.kind]} size="small" aria-hidden="true" />
            <span>{props.label}</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="attachment-pill-popover attachment-detail-popover">
              <Show
                when={props.kind === "browser"}
                fallback={<Popover.Title class="sr-only">{props.title}</Popover.Title>}
              >
                <div class="attachment-pill-popover-header">
                  <Popover.Title>{props.title}</Popover.Title>
                  <Popover.CloseButton
                    type="button"
                    class="attachment-pill-popover-close"
                    aria-label={`Close ${props.title.toLowerCase()}`}
                  >
                    <Icon name="close" size="small" aria-hidden="true" />
                  </Popover.CloseButton>
                </div>
              </Show>
              <div class="attachment-pill-popover-body attachment-detail-body">
                {props.children}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </Show>
      <Show when={props.onRemove}>
        {(remove) => (
          <RemoveAttachment
            label={props.removeLabel ?? `Remove ${props.title.toLowerCase()}`}
            onRemove={remove()}
            disabled={props.disabled}
          />
        )}
      </Show>
    </div>
  );
}

export function AttachmentImagePill(
  props: ImagePreviewSource &
    Pick<ImagePreviewProps, "alt" | "class"> & {
      readonly name: string;
      readonly onRemove?: Remove;
      readonly removeLabel?: string;
      /** Disables removal while leaving previews readable. */
      readonly disabled?: boolean;
    },
) {
  return (
    <div class="attachment-pill attachment-pill-image">
      <ImagePreview
        {...(props.file === undefined ? { src: props.src } : { file: props.file })}
        alt={props.alt}
        class={`attachment-pill-image-preview${props.class ? ` ${props.class}` : ""}`}
        imageClass="attachment-pill-thumb"
      >
        <span>{props.name}</span>
      </ImagePreview>
      <Show when={props.onRemove}>
        {(remove) => (
          <RemoveAttachment
            label={props.removeLabel ?? `Remove ${props.name}`}
            onRemove={remove()}
            disabled={props.disabled}
          />
        )}
      </Show>
    </div>
  );
}

export function AttachmentFilePill(props: {
  readonly name: string;
  readonly onRemove?: Remove;
  readonly removeLabel?: string;
  /** Disables removal while leaving previews readable. */
  readonly disabled?: boolean;
}) {
  return (
    <div class="attachment-pill attachment-pill-file">
      <FileIcon node={{ path: props.name, type: "file" }} mono aria-hidden="true" />
      <span title={props.name}>{props.name}</span>
      <Show when={props.onRemove}>
        {(remove) => (
          <RemoveAttachment
            label={props.removeLabel ?? `Remove ${props.name}`}
            onRemove={remove()}
            disabled={props.disabled}
          />
        )}
      </Show>
    </div>
  );
}
