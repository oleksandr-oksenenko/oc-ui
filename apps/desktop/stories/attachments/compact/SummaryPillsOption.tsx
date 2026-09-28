import { Icon } from "@opencode/ui/icon";
import { Show, createSignal, createUniqueId } from "solid-js";
import {
  annotations,
  browserAnnotation,
  files,
  reviewComments,
} from "../../attachment-fixtures.ts";
import { PillsOption } from "./PillsOption.tsx";
import "./summary-pills.css";

/** Story-only summary that reveals the existing compact pills treatment. */
export function SummaryPillsOption(props: { readonly initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = createSignal(props.initiallyExpanded ?? false);
  const pillsId = createUniqueId();
  const commentCount = reviewComments.length + annotations.length + [browserAnnotation].length;

  return (
    <section class="att-summary-pills" role="group" aria-label="Attachment summary">
      <button
        class="att-summary-pills-toggle"
        type="button"
        aria-expanded={expanded()}
        aria-controls={pillsId}
        onClick={() => setExpanded(!expanded())}
      >
        <Icon name="task" size="small" aria-hidden="true" />
        <span>
          {files.length} files · {commentCount} comments
        </span>
        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          size="small"
          aria-hidden="true"
        />
      </button>
      <Show when={expanded()}>
        <div class="att-summary-pills-content" id={pillsId}>
          <PillsOption />
        </div>
      </Show>
    </section>
  );
}
