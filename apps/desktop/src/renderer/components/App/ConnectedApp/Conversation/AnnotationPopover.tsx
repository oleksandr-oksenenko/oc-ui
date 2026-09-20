import { Button } from "@opencode/ui/button";
import { Popover } from "@opencode/ui/popover";
import { For, Show, createEffect, createMemo, onCleanup, untrack, type JSX } from "solid-js";

import { AnnotationCommentRow } from "./AnnotationPopover/AnnotationCommentRow.tsx";
import type { AnnotationPopoverController } from "./createTranscriptAnnotations.ts";

import "./AnnotationPopover.css";

export type AnnotationPopoverProps = {
  readonly controller: AnnotationPopoverController;
};

export function AnnotationPopover(props: AnnotationPopoverProps): JSX.Element {
  const state = () => props.controller.state();
  const open = createMemo(() => state().kind === "comments");
  createEffect(() => {
    if (!props.controller.selection()) return;
    const abort = new AbortController();
    const options = { capture: true, signal: abort.signal };
    const dismissOutside = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".annotation-selection-action")
      )
        props.controller.close();
    };
    window.addEventListener("pointerdown", dismissOutside, options);
    window.addEventListener("focusin", dismissOutside, options);
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") props.controller.close();
      },
      options,
    );
    onCleanup(() => abort.abort());
  });

  const closeFromPopover = (nextOpen: boolean) => {
    if (nextOpen) return;
    props.controller.close();
  };

  const comments = () => {
    const current = state();
    return current.kind === "comments" ? current.comments : [];
  };
  const editingID = () => {
    const current = state();
    return current.kind === "comments" ? current.editingID : undefined;
  };

  return (
    <>
      <Show when={props.controller.selection()}>
        {(selection) => (
          <div
            class="annotation-selection-action"
            style={{
              top: `${selection().anchor.top - 6}px`,
              transform: "translateY(-100%)",
              left: `${Math.max(8, Math.min(selection().anchor.left, window.innerWidth - (selection().error ? 272 : 110)))}px`,
            }}
          >
            <Button
              size="small"
              variant="outline"
              disabled={selection().pending}
              aria-busy={selection().pending}
              onPointerDown={(event: PointerEvent) => event.preventDefault()}
              onClick={() => void props.controller.openCandidate()}
            >
              Add note
            </Button>
            <Show when={selection().error}>
              {(error) => (
                <p class="annotation-selection-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Popover
        open={open()}
        onOpenChange={closeFromPopover}
        getAnchorRect={() => {
          const current = state();
          return current.kind === "closed" ? new DOMRect() : current.anchor;
        }}
        placement="bottom-start"
        title="Annotation comments"
        class="annotation-popover"
        triggerAs="span"
        triggerProps={{
          tabindex: -1,
          "aria-hidden": true,
          class: "annotation-popover-anchor",
          onFocus: () => {
            // OpenCode focuses this hidden trigger when a close does not come
            // from an outside click, including controller-driven dismissals
            // (transcript update, resize, scroll, navigation). Forward that
            // focus to a real target so it never rests on the anchor.
            if (state().kind !== "closed") return;
            const target = props.controller.focusTarget();
            if (!target) return;
            if (target.tabIndex < 0) target.tabIndex = -1;
            target.focus({ preventScroll: true });
          },
        }}
      >
        <div class="annotation-popup-comments">
          <For each={comments().map((item) => item.key)}>
            {(key) => {
              // Keep the last value available to blur handlers while the row is unmounting.
              const item = createMemo<ReturnType<typeof comments>[number]>(
                (previous) => comments().find((entry) => entry.key === key) ?? previous,
                untrack(() => comments().find((entry) => entry.key === key)!),
              );
              return (
                <AnnotationCommentRow
                  annotation={item().annotation}
                  readonly={item().readonly}
                  disabled={props.controller.disabled()}
                  editing={editingID() === key}
                  onEdit={() => props.controller.edit(key)}
                  onFinish={() => props.controller.finishEditing(key)}
                  onSubmit={() => {
                    // Enter finishes the edit and dismisses the popup like Escape.
                    props.controller.close();
                  }}
                  onInput={(body) => props.controller.updateBody(item().annotation.id, body)}
                  onRemove={() => props.controller.remove(item().annotation.id)}
                />
              );
            }}
          </For>
        </div>
      </Popover>
    </>
  );
}
