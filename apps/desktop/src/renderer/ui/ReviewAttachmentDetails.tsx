import { For } from "solid-js";

import { formatReviewSelection, type SentReviewComment } from "../opencode/code-review.ts";

export function ReviewAttachmentDetails(props: {
  readonly comments: readonly SentReviewComment[];
}) {
  return (
    <For each={props.comments}>
      {(comment) => (
        <div class="attachment-pill-comment attachment-detail-row">
          <p class="attachment-pill-comment-body">{comment.body}</p>
          <div class="attachment-pill-source">
            {comment.path} · {formatReviewSelection(comment.selection)}
          </div>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable review code needs keyboard access. */}
          <pre tabIndex={0}>{comment.selectedCode}</pre>
        </div>
      )}
    </For>
  );
}
