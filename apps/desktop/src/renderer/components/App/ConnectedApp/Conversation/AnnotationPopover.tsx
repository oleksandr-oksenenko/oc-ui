import { Button } from "@opencode-ai/ui/button";
import { LineCommentEditor } from "@opencode-ai/ui/line-comment";
import { Popover } from "@opencode-ai/ui/popover";
import { For, Show, createEffect, createMemo, createSignal, untrack, type JSX } from "solid-js";

import { AnnotationCommentRow } from "./AnnotationPopover/AnnotationCommentRow.tsx";
import type { AnnotationPopoverController } from "./createTranscriptAnnotations.ts";

import "./AnnotationPopover.css";

export type AnnotationPopoverProps = {
  readonly controller: AnnotationPopoverController;
};

export function AnnotationPopover(props: AnnotationPopoverProps): JSX.Element {
  const [editingID, setEditingID] = createSignal<string>();
  const [newBody, setNewBody] = createSignal("");
  let stateKey: string | undefined;
  let restoreOnTriggerFocus = false;

  createEffect(() => {
    const state = props.controller.state();
    const key =
      state.kind === "new"
        ? "new"
        : state.kind === "comments"
          ? `comments:${state.comments.map((item) => item.key).join("|")}`
          : state.kind;
    if (key === stateKey) return;
    stateKey = key;
    if (state.kind !== "closed") restoreOnTriggerFocus = false;
    setEditingID(undefined);
    setNewBody("");
  });

  const closeFromPopover = (open: boolean) => {
    if (open) return;
    // OpenCode suppresses trigger autofocus for outside clicks. Forward the
    // remaining close autofocus (Escape) from our virtual trigger to its opener.
    restoreOnTriggerFocus = true;
    props.controller.close();
  };

  const state = () => props.controller.state();
  const comments = () => {
    const current = state();
    return current.kind === "comments" ? current.comments : [];
  };
  const title = () => (state().kind === "new" ? "Add annotation" : "Annotation comments");
  const newState = () => {
    const value = state();
    return value.kind === "new" ? value : undefined;
  };

  return (
    <>
      <Show when={props.controller.selection()}>
        {(selection) => (
          <div
            class="annotation-selection-action"
            style={{
              top: `${selection().anchor.bottom + 6}px`,
              left: `${Math.max(8, Math.min(selection().anchor.left, window.innerWidth - 110))}px`,
            }}
          >
            <Button
              size="small"
              variant="outline"
              onPointerDown={(event: PointerEvent) => event.preventDefault()}
              onClick={() => props.controller.openCandidate()}
            >
              Add note
            </Button>
          </div>
        )}
      </Show>

      <Popover
        open={state().kind !== "closed"}
        onOpenChange={closeFromPopover}
        getAnchorRect={() => {
          const current = state();
          return current.kind === "closed" ? new DOMRect() : current.anchor;
        }}
        placement="bottom-start"
        title={title()}
        class="annotation-popover"
        triggerAs="span"
        triggerProps={{
          tabindex: -1,
          "aria-hidden": true,
          class: "annotation-popover-anchor",
          onFocus: () => {
            if (!restoreOnTriggerFocus || state().kind !== "closed") return;
            restoreOnTriggerFocus = false;
            const target = props.controller.focusTarget();
            if (!target) return;
            if (target.tabIndex < 0) target.tabIndex = -1;
            target.focus({ preventScroll: true });
          },
        }}
      >
        <Show
          when={state().kind === "new"}
          fallback={
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
                      onEdit={() => setEditingID(key)}
                      onFinish={() => {
                        setEditingID(undefined);
                        props.controller.removeEmpty(item().annotation.id);
                      }}
                      onInput={(body) => props.controller.updateBody(item().annotation.id, body)}
                      onRemove={() => props.controller.remove(item().annotation.id)}
                    />
                  );
                }}
              </For>
            </div>
          }
        >
          <Show when={newState()}>
            {(current) => (
              <LineCommentEditor
                heading="Add note"
                value={newBody()}
                onInput={(value) => {
                  setNewBody(value);
                }}
                onCancel={props.controller.close}
                onSubmit={(value) => void props.controller.addCandidate(value)}
                submitLabel="Add note"
                placeholder="Write a question or note…"
                selection={<>“{current().quote}”</>}
              />
            )}
          </Show>
        </Show>
      </Popover>
    </>
  );
}
