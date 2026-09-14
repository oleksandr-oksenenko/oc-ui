import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { LineComment } from "@opencode-ai/ui/line-comment";
import { Textarea } from "@opencode-ai/ui/textarea";
import { Show, untrack, type JSX } from "solid-js";

import type { TranscriptAnnotation } from "../../../../../domain/annotation-drafts.ts";

export function AnnotationCommentRow(props: {
  readonly annotation: TranscriptAnnotation;
  readonly readonly: boolean;
  readonly disabled: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onFinish: () => void;
  readonly onSubmit: () => void;
  readonly onInput: (body: string) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  return (
    <LineComment
      comment={
        <Show when={!props.readonly} fallback={props.annotation.body}>
          <Show
            when={props.editing}
            fallback={
              <button
                type="button"
                class="annotation-editable-comment"
                disabled={props.disabled}
                onClick={() => props.onEdit()}
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
              ref={(element) => requestAnimationFrame(() => element.focus())}
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
        </Show>
      }
      // The passage stays highlighted in the transcript; the popover shows only the comment.
      selection={undefined}
      actions={
        <Show when={!props.readonly}>
          <IconButton
            type="button"
            disabled={props.disabled}
            class="annotation-remove-comment"
            aria-label="Remove comment"
            size="small"
            variant="ghost-muted"
            icon={<Icon name="trash" size="small" aria-hidden="true" />}
            onClick={() => props.onRemove()}
          />
        </Show>
      }
    />
  );
}
