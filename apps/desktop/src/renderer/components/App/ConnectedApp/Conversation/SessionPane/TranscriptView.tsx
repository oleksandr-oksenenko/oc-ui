import type { SessionMessageInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { Button } from "@opencode/ui/button";
import { createAutoScroll } from "@opencode/ui/hooks";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "@opencode/ui/loader";
import { createEffect, createMemo, For, onCleanup, Show, type JSX } from "solid-js";

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

export type TranscriptViewProps = {
  readonly sessionID: string;
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
  let viewport: HTMLDivElement | undefined;
  let resumedSessionID: string | undefined;
  let resumeFrame: number | undefined;
  const working = () => props.sessionStatus === "running";
  const loading = createMemo(() => props.loading === true);

  const materialization = createTranscriptMaterialization({
    sessionID: () => props.sessionID,
    messages: () => props.messages,
  });
  // Keep the upstream follow-bottom active while older rows are still
  // prepending, so each batch stays pinned without a second scroll policy.
  // Memoized so the auto-scroll hook's working transition and the selection
  // listener only react when materializing actually starts or finishes.
  const autoScrollActive = createMemo(
    () => loading() || working() || materialization.materializing(),
  );

  const cancelResumeFrame = () => {
    if (resumeFrame === undefined) return;
    cancelAnimationFrame(resumeFrame);
    resumeFrame = undefined;
  };

  const selectionInViewport = () => {
    if (viewport === undefined) return false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    return viewport.contains(selection.getRangeAt(0).startContainer);
  };

  const { contentRef, handleInteraction, handleScroll, resume, scrollRef } = createAutoScroll({
    working: autoScrollActive,
    // The user acted before the deferred follow-bottom ran: drop it.
    onUserInteracted: cancelResumeFrame,
  });

  onCleanup(() => {
    cancelResumeFrame();
    viewport = undefined;
    detachAnnotations?.();
  });

  // While older rows are still prepending, a reader selecting text inside this
  // transcript must pause follow-bottom through the upstream interaction policy.
  // Selections in other panes are ignored, and the listener exists only for the
  // materialization window.
  createEffect(() => {
    if (!materialization.materializing()) return;
    const onSelectionChange = () => {
      if (!selectionInViewport()) return;
      handleInteraction();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));
  });

  createEffect(() => {
    const sessionID = props.sessionID;

    // Every selection or loading transition supersedes outstanding
    // presentation work for the previous ready state.
    onCleanup(cancelResumeFrame);

    if (loading()) {
      resumedSessionID = undefined;
      return;
    }
    if (resumedSessionID === sessionID) return;

    resumedSessionID = sessionID;
    // The transcript mounts its messages in this same update. Defer the
    // follow-bottom layout read to the next frame so it does not run
    // synchronously against the mass DOM update.
    resumeFrame = requestAnimationFrame(() => {
      resumeFrame = undefined;
      if (props.sessionID !== sessionID || loading()) return;
      if (selectionInViewport()) return;
      resume();
    });
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
        scrollRef(element);
        detachAnnotations = props.annotationRootRef?.(element);
      }}
      class="transcript-view oc-scrollable"
      tabIndex={-1}
      aria-busy={busy()}
      onScroll={handleScroll}
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
        <div ref={contentRef} class="transcript-document">
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
  props: Pick<TranscriptViewProps, "sessionStatus" | "onOpenAnnotation">,
): JSX.Element {
  switch (message.type) {
    case "user":
      return <UserMessage message={message} onOpenAnnotation={props.onOpenAnnotation} />;
    case "assistant":
      return <AssistantMessage message={message} sessionStatus={props.sessionStatus} />;
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
