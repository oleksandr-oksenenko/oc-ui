/* oxlint-disable jsx-a11y/no-static-element-interactions -- The transcript viewport is a scroll region; its gesture handlers manage follow-bottom, not an interactive widget role. */

import type { SessionMessageInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { Button } from "@opencode/ui/button";
import { createAutoScroll } from "@opencode/ui/hooks";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "@opencode/ui/loader";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  untrack,
  type JSX,
} from "solid-js";

import type { ServerFileImageReader } from "../../../../../opencode/file-images.ts";
import { AssistantMessage } from "./TranscriptView/AssistantMessage.tsx";
import { CompactionMessage } from "./TranscriptView/CompactionMessage.tsx";
import { ContextMessage } from "./TranscriptView/ContextMessage.tsx";
import { ShellMessage } from "./TranscriptView/ShellMessage.tsx";
import { SkillMessage } from "./TranscriptView/SkillMessage.tsx";
import { TimelineRow } from "./TranscriptView/TimelineRow.tsx";
import type { UserMessageProps } from "./TranscriptView/UserMessage.tsx";
import { UserMessage } from "./TranscriptView/UserMessage.tsx";
import { createTranscriptMaterialization } from "./TranscriptView/transcriptMaterialization.ts";

import "./SessionPane.css";

/** Nested scrollable regions keep their own keyboard and wheel behavior. */
function nestedScroll(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-scrollable]") !== null;
}

/** Editing keys and wheel input inside a field are not transcript navigation. */
function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

const scrollKeys = new Set(["End", "PageDown", "ArrowDown", "ArrowUp", "PageUp", "Home"]);
const downwardKeys = new Set(["End", "PageDown", "ArrowDown"]);
const TOUCH_THRESHOLD = 8;

/** Wheel input that navigates the transcript, excluding zoom, pan, fields. */
function navigationWheel(event: WheelEvent): boolean {
  return (
    !nestedScroll(event.target) &&
    !typingTarget(event.target) &&
    !event.ctrlKey &&
    !event.metaKey &&
    Math.abs(event.deltaX) <= Math.abs(event.deltaY) &&
    event.deltaY !== 0
  );
}

export type TranscriptViewProps = {
  readonly sessionID: string;
  /** Resolves `file:` images in assistant Markdown through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
  readonly annotationRootRef?: (element: HTMLDivElement) => (() => void) | void;
  readonly onOpenAnnotation?: UserMessageProps["onOpenAnnotation"];
  readonly messages: readonly SessionMessageInfo[];
  readonly sessionStatus: DataSessionStatus;
  readonly loading?: boolean;
  readonly error?: string;
  readonly workingLabel?: string;
  readonly onRetry?: () => void;
  readonly emptyMessage?: string;
  readonly pendingInteraction?: JSX.Element;
};

export function TranscriptView(props: TranscriptViewProps): JSX.Element {
  let detachAnnotations: (() => void) | void;
  let detachWheel: (() => void) | undefined;
  let viewport: HTMLDivElement | undefined;
  let resumeFrame: number | undefined;
  let scrollIntentBaseline: number | undefined;
  let scrollIntentTimer: number | undefined;
  type Positioning = {
    readonly sessionID: string;
    readonly status: "unpositioned" | "relinquished" | "positioned";
  };
  let positioning: Positioning | undefined;
  const [readerPaused, setReaderPaused] = createSignal(false);
  const working = () => props.sessionStatus === "running";
  const loading = createMemo(() => props.loading === true);

  const selectionInViewport = () => {
    if (viewport === undefined) return false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    return viewport.contains(selection.getRangeAt(0).startContainer);
  };

  // The reader is paused while a transcript selection exists, and stays paused
  // after it collapses until a deliberate scroll returns to the bottom. A
  // deliberate return resumes even with the selection still present; the next
  // selection interaction latches the pause again.
  const materialization = createTranscriptMaterialization({
    sessionID: () => props.sessionID,
    messages: () => props.messages,
    paused: readerPaused,
  });
  // Pausing withholds every follow reason, so a paused reader cannot be pinned
  // while older rows would mount. No scroll writes happen here.
  const autoScrollActive = createMemo(
    () => !readerPaused() && (loading() || working() || materialization.materializing()),
  );

  const cancelResumeFrame = () => {
    if (resumeFrame === undefined) return;
    cancelAnimationFrame(resumeFrame);
    resumeFrame = undefined;
  };

  const cancelScrollIntent = () => {
    if (scrollIntentTimer === undefined) return;
    clearTimeout(scrollIntentTimer);
    scrollIntentTimer = undefined;
    scrollIntentBaseline = undefined;
  };

  // Scroll intent arms only for transcript-directed gestures and expires
  // quickly, so a programmatic or layout scroll cannot resume on its own.
  const armScrollIntent = () => {
    scrollIntentBaseline = viewport?.scrollTop ?? 0;
    if (scrollIntentTimer !== undefined) clearTimeout(scrollIntentTimer);
    scrollIntentTimer = window.setTimeout(() => {
      scrollIntentTimer = undefined;
      scrollIntentBaseline = undefined;
    }, 400);
  };

  const canScroll = () => {
    const element = viewport;
    return element !== undefined && element.scrollHeight - element.clientHeight > 1;
  };

  const nearBottom = () => {
    const element = viewport;
    if (element === undefined) return false;
    return element.scrollHeight - element.clientHeight - element.scrollTop < 10;
  };

  // A deliberate downward gesture resumes immediately when there is no scroll
  // room left; otherwise it must be confirmed by real downward movement.
  const atBottom = () => !canScroll() || nearBottom();

  const resumeAtBottom = () => {
    cancelScrollIntent();
    setReaderPaused(false);
    // Clear upstream follow state so a return to the bottom is deliberate.
    resume();
  };

  const relinquishPositioning = () => {
    cancelResumeFrame();
    if (positioning !== undefined) {
      positioning = { sessionID: positioning.sessionID, status: "relinquished" };
    }
  };

  // One authoritative gesture consequence: any transcript navigation
  // relinquishes initial positioning, and only movement toward newer content
  // can return to the bottom.
  const handleReaderNavigation = (direction: "older" | "newer") => {
    relinquishPositioning();
    if (direction === "older") return;
    if (atBottom()) resumeAtBottom();
    else armScrollIntent();
  };

  const handleWheel = (event: WheelEvent) => {
    if (!navigationWheel(event)) {
      // Keep non-navigation wheel input (zoom, horizontal pan, fields) out of
      // the upstream follow policy as well.
      event.stopImmediatePropagation();
      return;
    }
    handleReaderNavigation(event.deltaY > 0 ? "newer" : "older");
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!scrollKeys.has(event.key)) return;
    if (nestedScroll(event.target) || typingTarget(event.target)) return;
    handleReaderNavigation(downwardKeys.has(event.key) ? "newer" : "older");
  };

  let touchStart: { readonly id: number; readonly y: number; readonly x: number } | undefined;

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (nestedScroll(event.target) || typingTarget(event.target)) return;
    touchStart = { id: event.pointerId, y: event.clientY, x: event.clientX };
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (touchStart === undefined || event.pointerId !== touchStart.id) return;
    const vertical = event.clientY - touchStart.y;
    const horizontal = event.clientX - touchStart.x;
    // A horizontal pan is not vertical transcript navigation.
    if (Math.abs(horizontal) > Math.abs(vertical)) return;
    if (Math.abs(vertical) <= TOUCH_THRESHOLD) return;
    touchStart = undefined;
    // Native touch scroll: a finger moving up reveals newer content and moves
    // toward the bottom.
    handleReaderNavigation(vertical < 0 ? "newer" : "older");
  };

  const endTouch = () => {
    touchStart = undefined;
  };

  // Created before the upstream hook's observer so a paused view can latch the
  // follow state before the hook's resize callback runs.
  const pauseObserver = new ResizeObserver(() => {
    if (!readerPaused()) return;
    untrack(() => {
      if (canScroll()) pause();
    });
  });

  const handleViewportScroll = () => {
    // While paused, upstream must not clear its follow latch from a layout or
    // clamping scroll; the reader pause stays authoritative until a deliberate
    // gesture resumes it.
    if (!readerPaused()) handleScroll();
    const baseline = scrollIntentBaseline;
    if (scrollIntentTimer === undefined || baseline === undefined) return;
    if (viewport !== undefined && viewport.scrollTop <= baseline) {
      // Without real downward movement this is not a return to the bottom.
      cancelScrollIntent();
      return;
    }
    if (canScroll() && nearBottom()) resumeAtBottom();
  };

  const { contentRef, handleScroll, pause, resume, scrollRef } = createAutoScroll({
    working: autoScrollActive,
    onUserInteracted: relinquishPositioning,
  });

  onCleanup(() => {
    cancelResumeFrame();
    cancelScrollIntent();
    pauseObserver.disconnect();
    detachWheel?.();
    detachWheel = undefined;
    touchStart = undefined;
    viewport = undefined;
    detachAnnotations?.();
  });

  // The listener lives for the component lifetime. The initial check runs
  // untracked so latching a selection cannot subscribe this effect to upstream
  // follow state, and it latches before any scheduled materialization frame can
  // advance.
  createEffect(() => {
    const latchSelectionPause = () => {
      if (!selectionInViewport()) return;
      cancelScrollIntent();
      setReaderPaused(true);
      relinquishPositioning();
      untrack(pause);
    };
    untrack(latchSelectionPause);
    document.addEventListener("selectionchange", latchSelectionPause);
    onCleanup(() => document.removeEventListener("selectionchange", latchSelectionPause));
  });

  // A new selection follows bottom normally and cancels presentation work that
  // belongs to the previous selection. Deferred so the initial mount does not
  // overwrite the initial selection latch.
  createEffect(
    on(
      () => props.sessionID,
      () => {
        cancelResumeFrame();
        cancelScrollIntent();
        touchStart = undefined;
        setReaderPaused(false);
      },
      { defer: true },
    ),
  );

  // Deferred positioning runs at most once per selection. Loading supersedes a
  // pending frame without relinquishing eligibility; a reader action or a
  // declined frame relinquishes it for the rest of that selection.
  createEffect(() => {
    const sessionID = props.sessionID;
    const isLoading = loading();
    if (positioning === undefined || positioning.sessionID !== sessionID) {
      positioning = { sessionID, status: "unpositioned" };
    }
    if (isLoading) {
      if (positioning.status === "unpositioned") cancelResumeFrame();
      return;
    }
    if (positioning.status !== "unpositioned" || resumeFrame !== undefined) return;
    const frame = requestAnimationFrame(() => {
      // Only the scheduled frame may clear its own handle, so a stale frame
      // cannot detach a replacement selection's pending positioning.
      if (resumeFrame === frame) resumeFrame = undefined;
      if (props.sessionID !== sessionID) return;
      if (loading()) return;
      if (readerPaused() || selectionInViewport()) {
        positioning = { sessionID, status: "relinquished" };
        return;
      }
      positioning = { sessionID, status: "positioned" };
      resume();
    });
    resumeFrame = frame;
  });

  const visibleMessages = createMemo(() => {
    const start = materialization.startIndex();
    const messages = props.messages;
    const visible = start === 0 ? messages : messages.slice(start);
    return visible.filter(isRenderableMessage);
  });
  // Rendered rows are real content; materializing reports that history is
  // still arriving without replacing the rows already on screen.
  const busy = () => props.loading === true || materialization.materializing();

  return (
    <div
      ref={(element) => {
        viewport = element;
        // Bubble phase, registered before the upstream hook's wheel listener:
        // rejected gestures stop there without blocking descendant handlers,
        // which have already received the event.
        element.addEventListener("wheel", handleWheel, { passive: true });
        detachWheel = () => element.removeEventListener("wheel", handleWheel);
        scrollRef(element);
        detachAnnotations = props.annotationRootRef?.(element);
      }}
      class="transcript-view oc-scrollable"
      tabIndex={-1}
      aria-busy={busy()}
      onScroll={handleViewportScroll}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endTouch}
      onPointerCancel={endTouch}
    >
      <Show when={props.loading === true && props.messages.length === 0}>
        <output class="transcript-state" aria-live="polite">
          <Loader class="transcript-state-loader" width={18} height={18} aria-hidden="true" />
          <span>Loading transcript</span>
        </output>
      </Show>

      <Show when={props.error !== undefined}>
        <div class="transcript-state transcript-error-state" role="alert">
          <Icon class="transcript-state-icon" name="warning" aria-hidden="true" />
          <p>{props.error}</p>
          <Show when={props.onRetry !== undefined}>
            <Button type="button" size="normal" variant="outline" onClick={() => props.onRetry?.()}>
              Retry
            </Button>
          </Show>
        </div>
      </Show>

      <Show
        when={
          props.loading !== true &&
          props.error === undefined &&
          props.messages.length === 0 &&
          props.pendingInteraction === undefined
        }
      >
        <div class="transcript-state transcript-empty-state">
          <p>{props.emptyMessage ?? "Start this session with a prompt"}</p>
        </div>
      </Show>

      <Show when={props.messages.length > 0 || working() || props.pendingInteraction !== undefined}>
        <div
          ref={(element) => {
            pauseObserver.observe(element);
            contentRef(element);
          }}
          class="transcript-document"
        >
          <For each={visibleMessages()}>{(message) => renderMessage(message, props)}</For>

          {props.pendingInteraction}

          <Show when={working()}>
            <output class="transcript-working" aria-live="polite">
              <Loader class="transcript-working-loader" width={14} height={14} aria-hidden="true" />
              <span>{props.workingLabel ?? "Working"}</span>
            </output>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Idle markers close a turn; the message list keeps them for turn boundaries,
// but the transcript renders no row for them.
type RenderableMessage = Exclude<SessionMessageInfo, { readonly type: "idle" }>;

function isRenderableMessage(message: SessionMessageInfo): message is RenderableMessage {
  return message.type !== "idle";
}

function renderMessage(
  message: RenderableMessage,
  props: Pick<TranscriptViewProps, "sessionStatus" | "onOpenAnnotation" | "readFileImage">,
): JSX.Element {
  switch (message.type) {
    case "user":
      return <UserMessage message={message} onOpenAnnotation={props.onOpenAnnotation} />;
    case "assistant":
      return (
        <AssistantMessage
          message={message}
          sessionStatus={props.sessionStatus}
          readFileImage={props.readFileImage}
        />
      );
    case "shell":
      return <ShellMessage message={message} />;
    case "skill":
      return <SkillMessage message={message} />;
    case "agent-switched":
      return (
        <TimelineRow
          id={message.id}
          icon="subagent"
          label="Agent switched"
          detail={`${message.previous ? `${message.previous} → ` : ""}${message.agent}`}
        />
      );
    case "model-switched":
      return (
        <TimelineRow
          id={message.id}
          icon="models"
          label="Model switched"
          detail={`${message.previous ? `${modelName(message.previous)} → ` : ""}${modelName(message.model)}`}
        />
      );
    case "location-switched":
      return (
        <TimelineRow
          id={message.id}
          icon="folder"
          label="Location switched"
          detail={message.location.directory}
        />
      );
    case "compaction":
      return <CompactionMessage message={message} />;
    case "system":
    case "synthetic":
      return (
        <ContextMessage
          id={message.id}
          icon={message.type === "system" ? "settings-gear" : "align-right"}
          label={message.type === "system" ? "System context" : "Context"}
          text={message.text}
          description={message.description}
        />
      );
    default: {
      const unreachable: never = message;
      return unreachable;
    }
  }
}

function modelName(model: { readonly providerID: string; readonly id: string }): string {
  return `${model.providerID}/${model.id}`;
}
