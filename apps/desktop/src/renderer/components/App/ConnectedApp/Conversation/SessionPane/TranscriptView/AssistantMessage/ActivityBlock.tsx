/* oxlint-disable react/refs -- Solid refs are assigned after render and read in effects or event handlers. */
import type { SessionMessageAssistant } from "@opencode/client";
import { Collapsible } from "@opencode/ui/collapsible";
import { Icon } from "@opencode/ui/icon";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";

import { annotationBlock } from "../../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "../createDeferredCollapsibleMount.ts";
import { ReasoningBlock } from "./ActivityBlock/ReasoningBlock.tsx";
import { ToolCall } from "./ActivityBlock/ToolCall.tsx";
import { WorkDetailMessage } from "./ActivityBlock/WorkDetailMessage.tsx";
import {
  activityLabel,
  activitySummary,
  shellCommandOutcome,
} from "./ActivityBlock/activitySummary.ts";
import type { ActivityContinuation, ActivityDetailInfo } from "../workDetailProjection.ts";
import "./ActivityBlock.css";

type Content = SessionMessageAssistant["content"][number];

function activitySteps(content: readonly Content[], start: number) {
  const items: Exclude<Content, { type: "text" }>[] = [];
  for (let index = start; index < content.length; index++) {
    const item = content[index]!;
    if (item.type === "text") break;
    items.push(item);
  }
  return items;
}

/** A consecutive run of activity; prose stays in its original position. */
export function ActivityBlock(props: {
  readonly content: readonly Content[];
  readonly start: number;
  readonly active: boolean;
  readonly disclosureKey?: string;
  readonly activityOpen?: Map<string, boolean>;
  readonly directory?: string;
  readonly workDetails?: readonly ActivityDetailInfo[];
  readonly continuations?: readonly ActivityContinuation[];
}) {
  const savedOpen = () =>
    props.disclosureKey === undefined ? undefined : props.activityOpen?.get(props.disclosureKey);
  const steps = createMemo(() => activitySteps(props.content, props.start));
  const continuationMessages = createMemo(() => props.continuations?.map((row) => row.message));
  const continuationDetails = (message: SessionMessageAssistant) =>
    message.content.some((part) => part.type === "text")
      ? []
      : (props.continuations?.find((row) => row.message.id === message.id)?.workDetails ?? []);
  const allSteps = createMemo(() => [
    ...steps(),
    ...(continuationMessages() ?? []).flatMap((message) => activitySteps(message.content, 0)),
  ]);
  const allDetails = createMemo(() => [
    ...(props.workDetails ?? []),
    ...(continuationMessages() ?? []).flatMap(continuationDetails),
  ]);
  const summary = createMemo(() =>
    activitySummary(allSteps(), allDetails(), props.active, props.directory),
  );
  const label = createMemo(() => activityLabel(allSteps(), allDetails()));
  const failureIDs = () => [
    ...allSteps().flatMap((step) =>
      step.type !== "tool"
        ? []
        : shellCommandOutcome(step) === "failed" || step.state.status === "error"
          ? [`tool:${step.id}`]
          : [],
    ),
    ...allDetails()
      .filter(
        (message) =>
          message.type === "shell" &&
          (message.status === "timeout" ||
            message.status === "killed" ||
            (message.status === "exited" && message.exit !== 0)),
      )
      .map((message) => `${message.type}:${message.id}`),
  ];
  const failed = () => failureIDs().length > 0;
  const mounted = createDeferredCollapsibleMount(savedOpen() ?? false);
  const [open, setOpen] = createSignal(savedOpen() ?? false);
  let trigger: HTMLButtonElement | undefined;
  let contentArea: HTMLDivElement | undefined;
  let pendingClose = false;
  const selectionInside = () => {
    const selection = window.getSelection();
    return (
      contentArea !== undefined &&
      selection !== null &&
      !selection.isCollapsed &&
      selection.rangeCount > 0 &&
      (contentArea.contains(selection.anchorNode) || contentArea.contains(selection.focusNode))
    );
  };
  const rememberOpen = (next: boolean) => {
    if (props.disclosureKey === undefined || props.activityOpen === undefined) return;
    if (!next) props.activityOpen.delete(props.disclosureKey);
    else props.activityOpen.set(props.disclosureKey, next);
  };
  const closeNow = () => {
    if (contentArea?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
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
          if (props.disclosureKey !== undefined) props.activityOpen?.delete(props.disclosureKey);
          closeAtTurnEnd();
          return;
        }
        stopWaitingForSelection();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    stopWaitingForSelection();
  });
  return (
    <Collapsible
      class="transcript-activity"
      variant="ghost"
      forceMount
      open={open()}
      data-active={summary() !== undefined}
      onOpenChange={(next) => {
        stopWaitingForSelection();
        mounted.onOpenChange(next);
        setOpen(next);
        rememberOpen(next);
      }}
    >
      <Collapsible.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
        }}
        class="transcript-activity-trigger"
      >
        <Show when={summary()}>
          <span class="transcript-activity-pulse" aria-hidden="true" />
        </Show>
        <span class="transcript-activity-title">{label() ?? summary() ?? "Activity"}</span>
        <Icon
          name={open() ? "chevron-down" : "chevron-right"}
          class="transcript-activity-chevron"
          size="small"
          aria-hidden="true"
        />
        <Show keyed when={failed() ? JSON.stringify(failureIDs()) : undefined}>
          <span class="transcript-activity-error" role="alert">
            · {failureIDs().length === 1 ? "Failed" : `${failureIDs().length} failed`}
          </span>
        </Show>
        <Show when={label() !== undefined ? summary() : undefined}>
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
            contentArea = element;
          }}
          class="transcript-activity-content"
        >
          <div class="transcript-activity-steps">
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
            <For each={continuationMessages()}>
              {(message) => (
                <div class="transcript-activity-continuation" data-message-id={message.id}>
                  <For each={activitySteps(message.content, 0)}>
                    {(step, index) =>
                      step.type === "reasoning" ? (
                        <ReasoningBlock
                          reasoning={step}
                          annotationBlock={annotationBlock("content", index(), "reasoning")}
                        />
                      ) : (
                        <ToolCall tool={step} directory={props.directory} />
                      )
                    }
                  </For>
                  <For each={continuationDetails(message)}>
                    {(detail) => <WorkDetailMessage message={detail} />}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
