import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Show, type JSX } from "solid-js";

import {
  formatReviewSelection,
  type SentReviewComment,
} from "../../../../../../../opencode/code-review.ts";

import { annotationBlock } from "../../../annotation-source.ts";
import { createDeferredCollapsibleMount } from "../createDeferredCollapsibleMount.ts";

export type CodeReviewCardProps = {
  readonly comments: readonly SentReviewComment[];
};

export function CodeReviewCard(props: CodeReviewCardProps): JSX.Element {
  const content = createDeferredCollapsibleMount();
  const count = () => props.comments.length;
  return (
    <Collapsible
      class="transcript-code-review-card"
      defaultOpen={false}
      onOpenChange={content.onOpenChange}
    >
      <Collapsible.Trigger class="transcript-code-review-trigger">
        <span>
          Code review · {count()} {count() === 1 ? "comment" : "comments"}
        </span>
      </Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content class="transcript-code-review-content">
          {props.comments.map((comment, index) => (
            <section class="transcript-code-review-comment" data-comment-index={index + 1}>
              <h3
                data-annotation-block={annotationBlock("review", index, "path")}
                class="transcript-code-review-path"
              >
                {comment.path}
              </h3>
              <p class="transcript-code-review-range">
                <strong>Range:</strong> {formatReviewSelection(comment.selection)}
              </p>
              <div class="transcript-code-review-section">
                <strong>Selected code</strong>
                <pre data-annotation-block={annotationBlock("review", index, "code")}>
                  {comment.selectedCode}
                </pre>
              </div>
              <div class="transcript-code-review-section">
                <strong>Comment</strong>
                <pre data-annotation-block={annotationBlock("review", index, "body")}>
                  {comment.body}
                </pre>
              </div>
            </section>
          ))}
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
}
