import { FileIcon } from "@opencode/ui/file-icon";
import { Icon } from "@opencode/ui/icon";
import { For, Show, createSignal, createUniqueId } from "solid-js";
import { ImagePreview } from "../../../src/renderer/ui/ImagePreview.tsx";
import { formatReviewSelection } from "../../../src/renderer/opencode/code-review.ts";
import {
  annotations,
  browserAnnotation,
  files,
  reviewComments,
} from "../../attachment-fixtures.ts";
import "./summary.css";

const browserImage = `data:${browserAnnotation.image.mime};base64,${btoa(
  String.fromCharCode(...browserAnnotation.image.data),
)}`;

/** Story-only attachment presentation. The message remains outside this component. */
export function SummaryOption() {
  const [expanded, setExpanded] = createSignal(false);
  const detailsId = createUniqueId();

  return (
    <section
      class="att-summary"
      classList={{ "att-summary--expanded": expanded() }}
      role="group"
      aria-label="Attachments"
    >
      <button
        class="att-summary-toggle"
        type="button"
        aria-expanded={expanded()}
        aria-controls={detailsId}
        onClick={() => setExpanded(!expanded())}
      >
        <Icon name="task" size="small" aria-hidden="true" />
        <span>4 files · 4 comments</span>
        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          size="small"
          aria-hidden="true"
        />
      </button>

      <Show when={expanded()}>
        <div id={detailsId} class="att-summary-details">
          <div class="att-summary-comments">
            <div class="att-summary-heading">Comments</div>
            <For each={reviewComments}>
              {(comment) => (
                <article class="att-summary-comment">
                  <p>{comment.body}</p>
                  <div class="att-summary-source">
                    <Icon name="code" size="small" aria-hidden="true" />
                    <span>{comment.path}</span>
                    <span>{formatReviewSelection(comment.selection)}</span>
                  </div>
                  <pre>{comment.selectedCode}</pre>
                </article>
              )}
            </For>
            <article class="att-summary-comment">
              <p>{annotations[0]!.body}</p>
              <div class="att-summary-source">
                <Icon name="comment" size="small" aria-hidden="true" />
                <span>Earlier response</span>
              </div>
              <blockquote>{annotations[0]!.quote}</blockquote>
            </article>
            <article class="att-summary-comment">
              <p>{browserAnnotation.body}</p>
              <div class="att-summary-source">
                <Icon name="globe" size="small" aria-hidden="true" />
                <span>{browserAnnotation.tab.title}</span>
                <span>{browserAnnotation.tab.url}</span>
                <span>Element · {browserAnnotation.selection.label}</span>
              </div>
              <div class="att-summary-browser-image">
                <ImagePreview
                  src={browserImage}
                  alt={browserAnnotation.image.name}
                  class="att-summary-image"
                />
                <span>Captured screenshot</span>
              </div>
            </article>
          </div>

          <div class="att-summary-files">
            <div class="att-summary-heading">Files</div>
            <div class="att-summary-file-list">
              <For each={files}>
                {(file) => (
                  <Show
                    when={file.mime.startsWith("image/")}
                    fallback={
                      <span class="att-summary-file">
                        <FileIcon
                          node={{ path: file.name!, type: "file" }}
                          mono
                          aria-hidden="true"
                        />
                        <span>{file.name}</span>
                      </span>
                    }
                  >
                    <span class="att-summary-file att-summary-file--image">
                      <ImagePreview
                        src={`data:${file.mime};base64,${file.data}`}
                        alt={file.name!}
                        class="att-summary-image"
                      />
                      <span>{file.name}</span>
                    </span>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
