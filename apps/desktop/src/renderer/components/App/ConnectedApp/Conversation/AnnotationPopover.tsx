import { Button } from "@opencode/ui/button";
import { Popover } from "@kobalte/core/popover";
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
              variant="ghost"
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
        gutter={5}
        fitViewport
      >
        <Popover.Trigger
          as="span"
          class="annotation-popover-anchor"
          tabindex={-1}
          aria-hidden="true"
        />
        <Popover.Portal>
          <Popover.Content
            id={props.controller.popupID}
            class="annotation-popover attachment-detail-popover"
            onOpenAutoFocus={(event) => {
              // Kobalte calls this inside a reactive effect; tracking editor state
              // here would reset its focus whenever the annotation body changes.
              if (untrack(editingID) !== undefined) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && props.controller.isOpener(target))
                event.preventDefault();
            }}
            onFocusOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && props.controller.isOpener(target))
                event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (untrack(() => open() || props.controller.selection())) return;
              const target = props.controller.focusTarget();
              if (!target) return;
              const active = document.activeElement;
              if (
                active !== document.body &&
                active !== null &&
                !active.matches(".annotation-popover-anchor") &&
                !active.closest(".annotation-popover")
              )
                return;
              if (target.tabIndex < 0) target.tabIndex = -1;
              target.focus({ preventScroll: true });
            }}
          >
            <Popover.Title class="sr-only">Transcript annotations</Popover.Title>
            <div class="annotation-popup-comments attachment-detail-body">
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
                      onNavigate={() => props.controller.jumpTo(key)}
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
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </>
  );
}
