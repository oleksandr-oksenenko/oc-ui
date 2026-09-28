import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { LineComment } from "@opencode/ui/line-comment";
import { Textarea } from "@opencode/ui/textarea";
import { Show, createSignal, untrack, type JSX } from "solid-js";

import type { TranscriptAnnotation } from "../../../../../domain/annotation-drafts.ts";
import { RemoveButton } from "../../../../../ui/RemoveButton.tsx";
import "../../../../../ui/AttachmentDetail.css";
import "./AnnotationCommentRow.css";

export function AnnotationCommentRow(props: {
  readonly annotation: TranscriptAnnotation;
  readonly readonly: boolean;
  readonly disabled: boolean;
  readonly editing: boolean;
  readonly onNavigate: () => boolean;
  readonly onEdit: () => void;
  readonly onFinish: () => void;
  readonly onSubmit: () => void;
  readonly onInput: (body: string) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [sourceUnavailable, setSourceUnavailable] = createSignal(false);
  return (
    <LineComment
      class="attachment-detail-row"
      comment={
        <Show
          when={props.editing && !props.readonly}
          fallback={
            <button
              type="button"
              class="annotation-comment-link"
              title="Go to highlighted passage"
              onClick={() => setSourceUnavailable(!props.onNavigate())}
            >
              {props.annotation.body}
            </button>
          }
        >
          <Textarea
            class="annotation-inline-editor"
            aria-label="Annotation comment"
            rows={1}
            disabled={props.disabled}
            placeholder="Write a question or note…"
            value={untrack(() => props.annotation.body)}
            ref={(element) =>
              requestAnimationFrame(() => {
                if (element.isConnected) element.focus({ preventScroll: true });
              })
            }
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onBlur={(event) => {
              const next = event.relatedTarget;
              const card = event.currentTarget.closest('[data-component="line-comment-v2"]');
              if (next instanceof Node && card?.contains(next)) return;
              props.onFinish();
            }}
            onKeyDown={(event) => {
              if (event.isComposing || event.keyCode === 229) return;
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              event.stopPropagation();
              props.onSubmit();
            }}
          />
        </Show>
      }
      selection={
        <>
          <span class="annotation-comment-quote">“{props.annotation.quote}”</span>
          <Show when={sourceUnavailable()}>
            <span class="annotation-source-unavailable" role="status">
              Highlighted passage unavailable
            </span>
          </Show>
        </>
      }
      actions={
        <Show when={!props.readonly}>
          <IconButton
            type="button"
            size="small"
            variant="ghost-muted"
            class="annotation-edit-comment"
            aria-label="Edit comment"
            title="Edit comment"
            disabled={props.disabled}
            icon={<Icon name="pencil-line" aria-hidden="true" />}
            onClick={() => props.onEdit()}
          />
          <RemoveButton
            disabled={props.disabled}
            class="annotation-remove-comment"
            label="Remove comment"
            onClick={() => props.onRemove()}
          />
        </Show>
      }
    />
  );
}
