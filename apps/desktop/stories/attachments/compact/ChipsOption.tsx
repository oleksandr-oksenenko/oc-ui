import { FileIcon } from "@opencode/ui/file-icon";
import { Icon } from "@opencode/ui/icon";
import { For, Show, createSignal, createUniqueId } from "solid-js";
import { formatReviewSelection } from "../../../src/renderer/opencode/code-review.ts";
import { ImagePreview } from "../../../src/renderer/ui/ImagePreview.tsx";
import {
  annotations,
  browserAnnotation,
  files,
  reviewComments,
} from "../../attachment-fixtures.ts";
import "./chips.css";

type Detail = "review" | "transcript" | "browser";

export function ChipsOption(props: { readonly expanded?: boolean }) {
  const detailId = createUniqueId();
  const [detail, setDetail] = createSignal<Detail | undefined>(
    props.expanded ? "review" : undefined,
  );
  const toggle = (next: Detail) => setDetail((current) => (current === next ? undefined : next));
  const screenshot = `data:${browserAnnotation.image.mime};base64,${btoa(
    String.fromCharCode(...browserAnnotation.image.data),
  )}`;

  return (
    <section class="att-chips" role="group" aria-label="Attachments">
      <div class="att-chips-list">
        <button
          type="button"
          class="att-chips-chip att-chips-disclosure"
          aria-expanded={detail() === "review"}
          aria-controls={detailId}
          onClick={() => toggle("review")}
        >
          <Icon name="code" size="small" aria-hidden="true" />
          <span>Code review</span>
          <span class="att-chips-count">{reviewComments.length}</span>
        </button>
        <button
          type="button"
          class="att-chips-chip att-chips-disclosure"
          aria-expanded={detail() === "transcript"}
          aria-controls={detailId}
          onClick={() => toggle("transcript")}
        >
          <Icon name="comment" size="small" aria-hidden="true" />
          <span>Transcript annotation</span>
          <span class="att-chips-count">{annotations.length}</span>
        </button>
        <button
          type="button"
          class="att-chips-chip att-chips-disclosure"
          aria-expanded={detail() === "browser"}
          aria-controls={detailId}
          onClick={() => toggle("browser")}
        >
          <Icon name="globe" size="small" aria-hidden="true" />
          <span>Browser annotation</span>
          <span class="att-chips-count">1</span>
        </button>
        <div class="att-chips-chip att-chips-image">
          <ImagePreview
            src={`data:${files[0]!.mime};base64,${files[0]!.data}`}
            alt={files[0]!.name!}
            class="att-chips-image-button"
          />
          <span>{files[0]!.name}</span>
        </div>
        <For each={files.slice(1)}>
          {(file) => (
            <span class="att-chips-chip att-chips-file">
              <FileIcon node={{ path: file.name!, type: "file" }} mono aria-hidden="true" />
              <span>{file.name}</span>
            </span>
          )}
        </For>
      </div>
      <Show when={detail()}>
        {(selected) => (
          <div id={detailId} class="att-chips-detail" aria-live="polite">
            <Show when={selected() === "review"}>
              <For each={reviewComments}>
                {(comment) => (
                  <section class="att-chips-comment">
                    <p>{comment.body}</p>
                    <div class="att-chips-source">
                      <span>{comment.path}</span>
                      <span>{formatReviewSelection(comment.selection)}</span>
                    </div>
                    <pre>{comment.selectedCode}</pre>
                  </section>
                )}
              </For>
            </Show>
            <Show when={selected() === "transcript"}>
              <p>{annotations[0]!.body}</p>
              <blockquote>{annotations[0]!.quote}</blockquote>
              <div class="att-chips-source">Earlier response</div>
            </Show>
            <Show when={selected() === "browser"}>
              <p>{browserAnnotation.body}</p>
              <div class="att-chips-source">
                <span>
                  {browserAnnotation.tab.title} · {browserAnnotation.tab.url}
                </span>
                <span>
                  {browserAnnotation.selection.label} · {browserAnnotation.selection.selector}
                </span>
              </div>
              <ImagePreview
                src={screenshot}
                alt={browserAnnotation.image.name}
                class="att-chips-screenshot"
              />
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}
