import { LineComment } from "@opencode/ui/line-comment";
import { For } from "solid-js";

import type { TranscriptAnnotation } from "../../../../../../../domain/annotation-drafts.ts";
import { AttachmentDetailPill } from "../../../../../../../ui/AttachmentPills.tsx";
import "./AnnotationCard.css";

export function AnnotationCard(props: {
  readonly annotations: readonly TranscriptAnnotation[];
  readonly onOpen?: (id: string, opener: HTMLElement) => void;
}) {
  return (
    <AttachmentDetailPill
      kind="annotations"
      label={`Annotations · ${props.annotations.length}`}
      title="Transcript annotations"
    >
      <div class="transcript-annotation-content">
        <For each={props.annotations}>
          {(annotation) => (
            <LineComment
              class="attachment-detail-row"
              comment={<span>{annotation.body}</span>}
              selection={
                <button
                  type="button"
                  class="transcript-annotation-quote"
                  disabled={!props.onOpen}
                  onClick={(event) => props.onOpen?.(annotation.id, event.currentTarget)}
                >
                  “{annotation.quote}”
                </button>
              }
            />
          )}
        </For>
      </div>
    </AttachmentDetailPill>
  );
}
