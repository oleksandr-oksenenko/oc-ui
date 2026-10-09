/* oxlint-disable jsx-a11y/no-static-element-interactions -- The transcript viewport is a scroll region; its gesture handlers manage follow-bottom, not an interactive widget role. */

import type { SessionMessageInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { Button } from "@opencode/ui/button";
import { createAutoScroll } from "@opencode/ui/hooks";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "../../../../../ui/Loader.tsx";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  untrack,
  type JSX,
} from "solid-js";

import type { ServerFileImageReader } from "../../../../../opencode/file-images.ts";
import { AssistantMessage } from "./TranscriptView/AssistantMessage.tsx";
import { ActivityBlock } from "./TranscriptView/AssistantMessage/ActivityBlock.tsx";
import type { UserMessageProps } from "./TranscriptView/UserMessage.tsx";
import { UserMessage } from "./TranscriptView/UserMessage.tsx";
import { createTranscriptMaterialization } from "./TranscriptView/transcriptMaterialization.ts";
import {
  projectTranscriptRows,
  type TranscriptRow,
} from "./TranscriptView/workDetailProjection.ts";
import { WorkDetailMessage } from "./TranscriptView/AssistantMessage/ActivityBlock/WorkDetailMessage.tsx";
import { projectGeneratedImages } from "./TranscriptView/generatedImages.ts";

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
// Matches the follow hook's settling window: growth within it is still pinned
// to the bottom, so only a position that survives it is reported as lost.
const POSITION_SETTLE_MS = 300;

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
  /** Required when selection and its message list are published separately. */
  readonly messagesSessionID?: string;
  /** Resolves `file:` images in assistant Markdown through the connected server. */
  readonly readFileImage?: ServerFileImageReader;
  /** Filesystem root of the session; tool path parameters inside it are shown relative. */
  readonly directory?: string;
  readonly annotationRootRef?: (element: HTMLDivElement) => (() => void) | void;
  /** Refresh anchored UI after a viewport layout adjustment, before its scroll event. */
  readonly onLayoutScroll?: () => void;
  readonly onOpenAnnotation?: UserMessageProps["onOpenAnnotation"];
  readonly messages: readonly SessionMessageInfo[];
  /** Reader disclosure choices survive transcript remounts during navigation. */
  readonly activityOpen?: Map<string, boolean>;
  readonly sessionStatus: DataSessionStatus;
  readonly connected?: boolean;
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
  let viewportHeight: number | undefined;
  let resumeFrame: number | undefined;
  let scrollIntentBaseline: number | undefined;
  let scrollIntentTimer: number | undefined;
  type Positioning = {
    readonly sessionID: string;
    readonly status: "unpositioned" | "relinquished" | "positioned";
  };
  let positioning: Positioning | undefined;
  const [readerPaused, setReaderPaused] = createSignal(false);
  // Whether the newest content is within the near-bottom threshold. Scrolls
  // update it immediately; resize-driven reads wait out the follow policy's
  // settling window so a lagging follow scroll cannot flash the control.
  const [atLatest, setAtLatest] = createSignal(true);
  let awayTimer: number | undefined;
  const working = () => props.sessionStatus === "running";
  const loading = createMemo(() => props.loading === true);
  const messages = () =>
    props.messagesSessionID === undefined || props.messagesSessionID === props.sessionID
      ? props.messages
      : [];

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
    messages,
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

  const nearBottom = (height?: number) => {
    const element = viewport;
    if (element === undefined) return false;
    return element.scrollHeight - (height ?? element.clientHeight) - element.scrollTop < 10;
  };

  // A deliberate downward gesture resumes immediately when there is no scroll
  // room left; otherwise it must be confirmed by real downward movement.
  const atBottom = () => !canScroll() || nearBottom();

  const positioningSettled = () =>
    positioning !== undefined &&
    positioning.sessionID === props.sessionID &&
    positioning.status !== "unpositioned";

  const cancelAwayTimer = () => {
    if (awayTimer === undefined) return;
    clearTimeout(awayTimer);
    awayTimer = undefined;
  };

  const markAtLatest = () => {
    cancelAwayTimer();
    setAtLatest(true);
  };

  // Reports settled geometry. Delayed reads wait out the follow policy's
  // settling window, so a lagging follow scroll cannot flash the control; a
  // deliberate reader scroll reports immediately.
  const readGeometry = (delayAway: boolean) => {
    if (!positioningSettled()) return;
    if (atBottom()) {
      markAtLatest();
      return;
    }
    if (!delayAway) {
      cancelAwayTimer();
      setAtLatest(false);
      return;
    }
    if (!atLatest() || awayTimer !== undefined) return;
    awayTimer = window.setTimeout(() => {
      awayTimer = undefined;
      if (positioningSettled() && !atBottom()) setAtLatest(false);
    }, POSITION_SETTLE_MS);
  };

  const resumeAtBottom = () => {
    cancelScrollIntent();
    setReaderPaused(false);
    markAtLatest();
    // Clear upstream follow state so a return to the bottom is deliberate.
    resume();
  };

  const relinquishPositioning = () => {
    cancelResumeFrame();
    if (positioning !== undefined) {
      positioning = { sessionID: positioning.sessionID, status: "relinquished" };
      // The reader owns the position now; report it even if the gesture
      // arrives before the initial placement frame could run.
      readGeometry(false);
    }
  };

  // One authoritative gesture consequence: any transcript navigation
  // relinquishes initial positioning. Older navigation also stops following
  // immediately: a content resize that lands before the gesture's scroll event
  // would otherwise pin the reader back to the bottom (upward wheel already
  // stops through the hook's own listener, so this covers keys and touch).
  // Only movement toward newer content can return to the bottom.
  const handleReaderNavigation = (direction: "older" | "newer") => {
    relinquishPositioning();
    if (direction === "older") {
      pause();
      return;
    }
    if (atBottom()) resumeAtBottom();
    else armScrollIntent();
  };

  // The control is one deliberate return to the newest content: it cancels
  // initial positioning and resumes follow even while a selection is present.
  // The viewport takes focus because the control unmounts on arrival, and a
  // keyboard reader must not drop back to the document.
  const scrollToLatest = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const controlFocused = event.currentTarget === document.activeElement;
    relinquishPositioning();
    resumeAtBottom();
    if (controlFocused) viewport?.focus({ preventScroll: true });
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
    const element = viewport;
    const height = element?.clientHeight;
    // Composer growth changes the viewport, not necessarily the document the
    // upstream hook observes. Preserve a bottom position before paint even
    // when idle or annotating, without resuming paused content/materialization.
    // Check the old height as well so simultaneous content growth cannot pull
    // a reader away from their passage.
    if (
      element !== undefined &&
      viewportHeight !== undefined &&
      height !== viewportHeight &&
      positioningSettled() &&
      atLatest() &&
      nearBottom(viewportHeight) &&
      (readerPaused() || !userScrolled())
    ) {
      if (readerPaused()) element.scrollTop = element.scrollHeight;
      else forceScrollToBottom();
      props.onLayoutScroll?.();
    }
    viewportHeight = height;
    readGeometry(true);
    if (!readerPaused()) return;
    untrack(() => {
      if (canScroll()) pause();
    });
  });

  const handleViewportScroll = () => {
    // While paused, upstream must not clear its follow latch from a layout or
    // clamping scroll; the reader pause stays authoritative until a deliberate
    // gesture resumes it. Before the selected session is placed, a bare scroll
    // cannot distinguish layout from reader input, so initial placement keeps
    // ownership: explicit gestures relinquish it directly, and only a settled
    // session feeds the follow policy's own interaction inference.
    if (!readerPaused() && positioningSettled()) handleScroll();
    // The hook has seen this scroll by now, so a stopped follow reports
    // immediately while a layout scroll waits out the settling window.
    readGeometry(!userScrolled());
    const baseline = scrollIntentBaseline;
    if (scrollIntentTimer === undefined || baseline === undefined) return;
    if (viewport !== undefined && viewport.scrollTop <= baseline) {
      // Without real downward movement this is not a return to the bottom.
      cancelScrollIntent();
      return;
    }
    if (canScroll() && nearBottom()) resumeAtBottom();
  };

  const { contentRef, forceScrollToBottom, handleScroll, pause, resume, scrollRef, userScrolled } =
    createAutoScroll({
      working: autoScrollActive,
      onUserInteracted: relinquishPositioning,
    });

  // One operation owns a selection's claim on the transcript: it cancels
  // placement and scroll intent, holds materialization, and stops following.
  // The listener and the placement frame both use it, so a selection latched
  // from `selectionchange` and one found by the frame cannot diverge.
  const pauseForSelection = () => {
    cancelScrollIntent();
    setReaderPaused(true);
    relinquishPositioning();
    untrack(pause);
  };

  onCleanup(() => {
    cancelResumeFrame();
    cancelAwayTimer();
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
      pauseForSelection();
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
        markAtLatest();
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
        // The frame can find a selection the listener has not latched yet;
        // route it through the same operation so the pause always holds.
        pauseForSelection();
        return;
      }
      positioning = { sessionID, status: "positioned" };
      resume();
      readGeometry(false);
    });
    resumeFrame = frame;
  });

  const generatedImages = createMemo(() => projectGeneratedImages(messages()));
  const visibleProjection = createMemo(() => {
    const start = materialization.startIndex();
    const list = messages();
    const visible = start === 0 ? list : list.slice(start);
    return projectTranscriptRows(visible);
  });
  // Durable acknowledgement can replace an SDK object without changing its ID.
  const rowsByKey = createMemo(
    () =>
      new Map(
        visibleProjection().map((row) => [JSON.stringify([props.sessionID, row.message.id]), row]),
      ),
  );
  const visibleMessageKeys = createMemo(() => [...rowsByKey().keys()]);
  // A message can finish while its turn keeps running. The last user/idle
  // marker, rather than message completion, owns the live activity boundary.
  const activeTurnMessages = createMemo(() => {
    if (!working()) return new Set<string>();
    const active = new Set<string>();
    for (let index = messages().length - 1; index >= 0; index--) {
      const message = messages()[index]!;
      if (message.type === "idle" || message.type === "user") break;
      active.add(message.id);
    }
    return active;
  });
  // Tool completion does not end activity. Visible prose ends the preceding
  // activity run, including runs chained across assistant messages.
  const liveActivityMessages = createMemo(() => {
    const live = new Set<string>();
    for (let index = messages().length - 1; index >= 0; index--) {
      const message = messages()[index]!;
      if (!activeTurnMessages().has(message.id)) break;
      live.add(message.id);
      if (
        message.type === "assistant" &&
        message.content.some((part) => part.type === "text" && part.text.trim())
      )
        break;
    }
    return live;
  });
  const hasLiveActivity = createMemo(() =>
    visibleProjection().some(
      (row) =>
        activeTurnMessages().has(row.message.id) &&
        (row.activityGroup === true ||
          (row.message.type === "assistant" &&
            (row.message.content.some((part) => part.type !== "text") ||
              row.workDetails.length > 0))),
    ),
  );
  // Rendered rows are real content; materializing reports that history is
  // still arriving without replacing the rows already on screen.
  const busy = () => props.loading === true || materialization.materializing();

  return (
    <div
      ref={(element) => {
        viewport = element;
        // A window resize can move the newest content out of view without
        // resizing the document or firing a scroll.
        pauseObserver.observe(element);
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
      <Show when={props.loading === true && messages().length === 0}>
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
            <Button type="button" size="small" variant="outline" onClick={() => props.onRetry?.()}>
              Retry
            </Button>
          </Show>
        </div>
      </Show>

      <Show
        when={
          props.loading !== true &&
          props.error === undefined &&
          messages().length === 0 &&
          props.pendingInteraction === undefined
        }
      >
        <div class="transcript-state transcript-empty-state">
          <p>{props.emptyMessage ?? "Start this session with a prompt"}</p>
        </div>
      </Show>

      <Show when={messages().length > 0 || working() || props.pendingInteraction !== undefined}>
        <div
          ref={(element) => {
            pauseObserver.observe(element);
            contentRef(element);
          }}
          class="transcript-document"
        >
          <For each={visibleMessageKeys()}>
            {(key) =>
              renderMessage(props, activeTurnMessages, liveActivityMessages, generatedImages, () =>
                rowsByKey().get(key),
              )
            }
          </For>

          {props.pendingInteraction}

          <Show when={working() && !hasLiveActivity()}>
            <output class="transcript-working" aria-live="polite">
              <Loader class="transcript-working-loader" width={14} height={14} aria-hidden="true" />
              <span>{props.workingLabel ?? "Working"}</span>
            </output>
          </Show>
        </div>
      </Show>
      <Show when={!atLatest() && canScroll()}>
        <div class="transcript-scroll-anchor">
          <button
            class="transcript-scroll-to-bottom"
            type="button"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            onClick={scrollToLatest}
          >
            <Icon name="arrow-down-to-line" aria-hidden="true" />
          </button>
        </div>
      </Show>
    </div>
  );
}

function renderMessage(
  props: Pick<
    TranscriptViewProps,
    | "sessionID"
    | "sessionStatus"
    | "connected"
    | "onOpenAnnotation"
    | "readFileImage"
    | "directory"
    | "activityOpen"
  >,
  activeTurnMessages: () => ReadonlySet<string>,
  liveActivityMessages: () => ReadonlySet<string>,
  generatedImages: () => ReturnType<typeof projectGeneratedImages>,
  row: () => TranscriptRow | undefined,
): JSX.Element {
  const user = () => {
    const message = row()?.message;
    return message?.type === "user" ? message : undefined;
  };
  const assistant = () => {
    const message = row()?.message;
    return message?.type === "assistant" ? message : undefined;
  };
  const work = () => {
    const message = row()?.message;
    return message && message.type !== "user" && message.type !== "assistant" ? message : undefined;
  };
  return (
    <Switch>
      <Match when={user()}>
        {(message) => <UserMessage message={message()} onOpenAnnotation={props.onOpenAnnotation} />}
      </Match>
      <Match when={assistant()}>
        {(message) => (
          <AssistantMessage
            message={message()}
            workDetails={row()?.workDetails}
            continuations={row()?.continuations}
            chainedTo={row()?.chainedTo}
            generatedImages={generatedImages().fallback.get(message().id)}
            resolveAttachment={(index, reference) =>
              generatedImages().resolve(message().id, index, reference)
            }
            sessionID={props.sessionID}
            sessionStatus={props.sessionStatus}
            connected={props.connected}
            turnActive={activeTurnMessages().has(message().id)}
            activityLive={
              liveActivityMessages().has(message().id) ||
              row()?.continuations?.some((item) => liveActivityMessages().has(item.message.id))
            }
            activityOpen={props.activityOpen}
            readFileImage={props.readFileImage}
            directory={props.directory}
          />
        )}
      </Match>
      <Match when={work()}>
        {(message) => (
          <Show
            when={row()?.activityGroup ? row()?.workDetails : undefined}
            fallback={
              <Show keyed when={message()}>
                {(detail) => <WorkDetailMessage message={detail} />}
              </Show>
            }
          >
            {(details) => (
              <ActivityBlock
                content={[]}
                start={0}
                workDetails={details()}
                active={activeTurnMessages().has(message().id)}
                live={liveActivityMessages().has(message().id)}
                disclosureKey={JSON.stringify([props.sessionID, message().id, "work-details"])}
                activityOpen={props.activityOpen}
                directory={props.directory}
              />
            )}
          </Show>
        )}
      </Match>
    </Switch>
  );
}
