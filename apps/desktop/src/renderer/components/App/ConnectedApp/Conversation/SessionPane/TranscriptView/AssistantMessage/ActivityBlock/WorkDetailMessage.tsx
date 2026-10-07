import type { SessionMessageInfo } from "@opencode/client";
import type { JSX } from "solid-js";

import { CompactionMessage } from "./WorkDetailMessage/CompactionMessage.tsx";
import { ContextMessage } from "./WorkDetailMessage/ContextMessage.tsx";
import { ShellMessage } from "./WorkDetailMessage/ShellMessage.tsx";
import { SkillMessage } from "./WorkDetailMessage/SkillMessage.tsx";
import { TimelineRow } from "./WorkDetailMessage/TimelineRow.tsx";
import { BackgroundProcessMessage } from "./WorkDetailMessage/BackgroundProcessMessage.tsx";
import { backgroundProcessUpdate } from "./WorkDetailMessage/backgroundProcessUpdate.ts";

export type WorkDetailInfo = Exclude<
  SessionMessageInfo,
  { readonly type: "idle" | "user" | "assistant" }
>;

/** Keeps the same work-detail row in the transcript and inside a turn's Activity. */
export function WorkDetailMessage(props: { readonly message: WorkDetailInfo }): JSX.Element {
  const message = props.message;
  switch (message.type) {
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
    case "synthetic": {
      const update = backgroundProcessUpdate(message);
      if (update !== undefined) return <BackgroundProcessMessage id={message.id} update={update} />;
      return (
        <ContextMessage
          id={message.id}
          icon="align-right"
          label="Context"
          text={message.text}
          description={message.description}
        />
      );
    }
    case "system":
      return (
        <ContextMessage
          id={message.id}
          icon="settings-gear"
          label="System context"
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
