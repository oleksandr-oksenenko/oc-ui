import type { LocationRef, SessionMessageInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { Button } from "@opencode-ai/ui/button";
import { createAutoScroll } from "@opencode-ai/ui/hooks";
import { Loader } from "@opencode-ai/ui/loader";
import { createEffect, Show, type JSX } from "solid-js";

import { AssistantMessage } from "./TranscriptView/AssistantMessage.tsx";
import { CompactionMessage } from "./TranscriptView/CompactionMessage.tsx";
import { ContextMessage } from "./TranscriptView/ContextMessage.tsx";
import { ShellMessage } from "./TranscriptView/ShellMessage.tsx";
import { SkillMessage } from "./TranscriptView/SkillMessage.tsx";
import { TimelineRow } from "./TranscriptView/TimelineRow.tsx";
import { UserMessage } from "./TranscriptView/UserMessage.tsx";

import "./SessionPane.css";

export type TranscriptViewProps = {
  readonly sessionID: string;
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
  let openedSessionID: string | undefined;
  const working = () => props.sessionStatus === "running";
  const autoScrollActive = () => props.loading === true || working();
  const { contentRef, handleScroll, resume, scrollRef } = createAutoScroll({
    working: autoScrollActive,
  });

  createEffect(() => {
    const sessionID = props.sessionID;
    if (props.loading === true || openedSessionID === sessionID) return;
    openedSessionID = sessionID;
    resume();
  });

  return (
    <div
      ref={scrollRef}
      class="transcript-view"
      aria-busy={props.loading === true}
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
          {props.messages.map((message) => renderMessage(message, props.sessionStatus))}

          {props.pendingInteraction}

          <Show when={working()}>
            <output class="transcript-working" aria-live="polite">
              <Loader class="transcript-working-loader" aria-hidden="true" />
              <span>{props.workingLabel ?? "Working"}</span>
            </output>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function renderMessage(message: SessionMessageInfo, sessionStatus: DataSessionStatus): JSX.Element {
  switch (message.type) {
    case "user":
      return <UserMessage message={message} />;
    case "assistant":
      return <AssistantMessage message={message} sessionStatus={sessionStatus} />;
    case "shell":
      return <ShellMessage message={message} />;
    case "skill":
      return <SkillMessage message={message} />;
    case "agent-switched":
      return (
        <TimelineRow
          id={message.id}
          icon="prompt"
          label="Agent switched"
          detail={`${message.previous ? `${message.previous} → ` : ""}${message.agent}`}
        />
      );
    case "model-switched":
      return (
        <TimelineRow
          id={message.id}
          icon="outline-dots"
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
          detail={locationName(message.location)}
        />
      );
    case "compaction":
      return <CompactionMessage message={message} />;
    case "system":
      return (
        <ContextMessage
          id={message.id}
          label="System context"
          text={message.text}
          description={message.description}
        />
      );
    case "synthetic":
      return (
        <ContextMessage
          id={message.id}
          label="Context"
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

function locationName(location: LocationRef): string {
  return location.directory;
}
