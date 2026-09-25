/* oxlint-disable react/refs -- Solid refs are assigned after render and read in effects or event handlers. */
import type { SessionMessageAssistant } from "@opencode/client";
import { Collapsible } from "@opencode/ui/collapsible";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";

import { annotationBlock } from "../../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "../createDeferredCollapsibleMount.ts";
import { ReasoningBlock } from "./ActivityBlock/ReasoningBlock.tsx";
import { ToolCall } from "./ActivityBlock/ToolCall.tsx";
import { WorkDetailMessage, type WorkDetailInfo } from "../WorkDetailMessage.tsx";
import { activitySummary } from "./ActivityBlock/activitySummary.ts";
import "./ActivityBlock.css";

type Content = SessionMessageAssistant["content"][number];

/** A consecutive run of activity; prose stays in its original position. */
export function ActivityBlock(props: {
  readonly content: readonly Content[];
  readonly start: number;
  readonly active: boolean;
  readonly disclosureKey?: string;
  readonly activityOpen?: Map<string, boolean>;
  readonly directory?: string;
  readonly workDetails?: readonly WorkDetailInfo[];
}) {
  const savedOpen = () =>
    props.disclosureKey === undefined ? undefined : props.activityOpen?.get(props.disclosureKey);
  const steps = createMemo(() => {
    const items: Exclude<Content, { type: "text" }>[] = [];
    for (let index = props.start; index < props.content.length; index++) {
      const item = props.content[index]!;
      if (item.type === "text") break;
      items.push(item);
    }
    return items;
  });
  const stepCount = () => steps().length + (props.workDetails?.length ?? 0);
  const summary = createMemo(() =>
    activitySummary(steps(), props.workDetails ?? [], props.active, props.directory),
  );
  const failureIDs = () => [
    ...steps().flatMap((step) =>
      step.type === "tool" && step.state.status === "error" ? [`tool:${step.id}`] : [],
    ),
    ...(props.workDetails ?? [])
      .filter(
        (message) =>
          (message.type === "shell" &&
            (message.status === "timeout" ||
              message.status === "killed" ||
              (message.status === "exited" && message.exit !== 0))) ||
          (message.type === "compaction" && message.status === "failed"),
      )
      .map((message) => `${message.type}:${message.id}`),
  ];
  const failed = () => failureIDs().length > 0;
  const mounted = createDeferredCollapsibleMount(savedOpen() ?? (props.active || failed()));
  const [open, setOpen] = createSignal(savedOpen() ?? (props.active || failed()));
  let trigger: HTMLButtonElement | undefined;
  let scrollArea: HTMLDivElement | undefined;
  let follow = true;
  let lastScrollTop = 0;
  let followFrame: number | undefined;
  let observer: ResizeObserver | undefined;
  let pendingClose = false;
  const selectionInside = () => {
    const selection = window.getSelection();
    return (
      scrollArea !== undefined &&
      selection !== null &&
      !selection.isCollapsed &&
      selection.rangeCount > 0 &&
      (scrollArea.contains(selection.anchorNode) || scrollArea.contains(selection.focusNode))
    );
  };
  const rememberOpen = (next: boolean) => {
    if (props.disclosureKey === undefined || props.activityOpen === undefined) return;
    if (next === (props.active || failed())) props.activityOpen.delete(props.disclosureKey);
    else props.activityOpen.set(props.disclosureKey, next);
  };
  const scheduleFollow = () => {
    if (selectionInside()) follow = false;
    if (!open() || !follow || followFrame !== undefined) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = undefined;
      if (selectionInside()) follow = false;
      if (open() && follow && scrollArea) {
        scrollArea.scrollTop = scrollArea.scrollHeight;
        lastScrollTop = scrollArea.scrollTop;
      }
    });
  };
  const closeNow = () => {
    if (scrollArea?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
    setOpen(false);
  };
  const stopWaitingForSelection = () => {
    if (!pendingClose) return;
    pendingClose = false;
    document.removeEventListener("selectionchange", selectionChanged);
  };
  const selectionChanged = () => {
    if (selectionInside()) return;
    stopWaitingForSelection();
    closeNow();
  };
  const closeAtTurnEnd = () => {
    if (selectionInside()) {
      if (!pendingClose) {
        pendingClose = true;
        document.addEventListener("selectionchange", selectionChanged);
      }
      return;
    }
    stopWaitingForSelection();
    closeNow();
  };

  // Only a turn transition changes disclosure automatically. A reader's close
  // during streaming remains their choice until this turn finishes.
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) {
          if (failed()) return;
          if (props.disclosureKey !== undefined) props.activityOpen?.delete(props.disclosureKey);
          closeAtTurnEnd();
          return;
        }
        stopWaitingForSelection();
        follow = true;
        mounted.onOpenChange(true);
        setOpen(true);
        scheduleFollow();
      },
      { defer: true },
    ),
  );
  let previousFailureIDs = new Set(failureIDs());
  createEffect(() => {
    const currentFailureIDs = new Set(failureIDs());
    if ([...currentFailureIDs].some((id) => !previousFailureIDs.has(id))) {
      stopWaitingForSelection();
      mounted.onOpenChange(true);
      setOpen(true);
    }
    previousFailureIDs = currentFailureIDs;
  });
  createEffect(() => {
    if (!open()) return;
    if (stepCount() > 0) scheduleFollow();
  });
  onCleanup(() => {
    stopWaitingForSelection();
    observer?.disconnect();
    if (followFrame !== undefined) cancelAnimationFrame(followFrame);
  });
  return (
    <Collapsible
      class="transcript-activity"
      variant="ghost"
      forceMount
      open={open()}
      data-active={props.active}
      onOpenChange={(next) => {
        stopWaitingForSelection();
        if (next) follow = true;
        mounted.onOpenChange(next);
        setOpen(next);
        rememberOpen(next);
        if (next) scheduleFollow();
      }}
    >
      <Collapsible.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
        }}
        class="transcript-activity-trigger"
      >
        <Collapsible.Arrow aria-hidden="true" />
        <Show when={props.active}>
          <span class="transcript-activity-pulse" aria-hidden="true" />
        </Show>
        <span class="transcript-activity-title">{props.active ? "Working" : "Activity"}</span>
        <span class="transcript-activity-count">
          {` · ${stepCount()} ${stepCount() === 1 ? "step" : "steps"}`}
        </span>
        <Show keyed when={failed() ? JSON.stringify(failureIDs()) : undefined}>
          <span class="transcript-activity-error" role="alert">
            · {failureIDs().length === 1 ? "Failed" : `${failureIDs().length} failed`}
          </span>
        </Show>
        <Show when={summary()}>
          {(text) => (
            <span class="transcript-activity-summary" title={text()}>
              {text()}
            </span>
          )}
        </Show>
      </Collapsible.Trigger>
      <Show when={mounted.mount()}>
        <Collapsible.Content
          ref={(element: HTMLDivElement) => {
            scrollArea = element;
          }}
          class="transcript-activity-content oc-scrollable"
          data-scrollable
          tabIndex={0}
          aria-label="Activity steps"
          onScroll={(event: UIEvent & { currentTarget: HTMLDivElement }) => {
            const element = event.currentTarget;
            if (selectionInside()) follow = false;
            else if (element.scrollHeight - element.clientHeight - element.scrollTop < 20)
              follow = true;
            else if (element.scrollTop < lastScrollTop - 1) follow = false;
            lastScrollTop = element.scrollTop;
          }}
          onWheel={(event: WheelEvent) => {
            if (event.deltaY < 0) follow = false;
          }}
        >
          <div
            ref={(element) => {
              observer = new ResizeObserver(() => scheduleFollow());
              observer.observe(element);
            }}
            class="transcript-activity-steps"
          >
            <For each={steps()}>
              {(step, index) =>
                step.type === "reasoning" ? (
                  <ReasoningBlock
                    reasoning={step}
                    annotationBlock={annotationBlock("content", props.start + index(), "reasoning")}
                  />
                ) : (
                  <ToolCall tool={step} directory={props.directory} />
                )
              }
            </For>
            <For each={props.workDetails}>
              {(message) => <WorkDetailMessage message={message} />}
            </For>
          </div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
