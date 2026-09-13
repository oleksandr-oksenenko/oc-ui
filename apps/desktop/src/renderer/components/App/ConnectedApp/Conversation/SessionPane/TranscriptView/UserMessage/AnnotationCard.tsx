import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { LineComment } from "@opencode-ai/ui/line-comment";
import { For } from "solid-js";

import type { TranscriptAnnotation } from "../../../../../../../domain/annotation-drafts.ts";
import { annotationBlock } from "../../../annotation-source.ts";
import "./AnnotationCard.css";

export function AnnotationCard(props: {
  readonly annotations: readonly TranscriptAnnotation[];
  readonly onOpen?: (id: string, opener: HTMLElement) => void;
}) {
  return (
    <Collapsible class="transcript-annotation-card" defaultOpen={false}>
      <Collapsible.Trigger class="transcript-annotation-trigger">
        <Icon name="comment" size="small" aria-hidden="true" />
        <span>
          Annotations · {props.annotations.length}{" "}
          {props.annotations.length === 1 ? "comment" : "comments"}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content class="transcript-annotation-content">
        <For each={props.annotations}>
          {(annotation) => (
            <LineComment
              comment={
                <span data-annotation-block={annotationBlock("annotations", annotation.id, "body")}>
                  {annotation.body}
                </span>
              }
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
      </Collapsible.Content>
    </Collapsible>
  );
}
