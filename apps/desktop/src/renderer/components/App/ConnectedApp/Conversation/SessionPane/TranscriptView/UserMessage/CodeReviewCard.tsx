import { Collapsible } from "@opencode-ai/ui/collapsible";
import type { JSX } from "solid-js";

import {
  formatReviewSelection,
  type SentCodeReview,
} from "../../../../../../../opencode/code-review.ts";

export type CodeReviewCardProps = {
  readonly review: SentCodeReview;
};

export function CodeReviewCard(props: CodeReviewCardProps): JSX.Element {
  const count = () => props.review.comments.length;
  return (
    <Collapsible class="transcript-code-review-card" defaultOpen={false}>
      <Collapsible.Trigger class="transcript-code-review-trigger">
        <span>
          Code review · {count()} {count() === 1 ? "comment" : "comments"}
        </span>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content class="transcript-code-review-content">
        {props.review.comments.map((comment, index) => (
          <section class="transcript-code-review-comment" data-comment-index={index + 1}>
            <h3 class="transcript-code-review-path">{comment.path}</h3>
            <p class="transcript-code-review-range">
              <strong>Range:</strong> {formatReviewSelection(comment.selection)}
            </p>
            <div class="transcript-code-review-section">
              <strong>Selected code</strong>
              <pre>{comment.selectedCode}</pre>
            </div>
            <div class="transcript-code-review-section">
              <strong>Comment</strong>
              <pre>{comment.body}</pre>
            </div>
          </section>
        ))}
      </Collapsible.Content>
    </Collapsible>
  );
}
