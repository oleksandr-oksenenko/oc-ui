import { FileIcon } from "@opencode/ui/file-icon";
import { Icon } from "@opencode/ui/icon";
import { For, Match, Show, Switch, createSignal, createUniqueId } from "solid-js";
import { formatReviewSelection } from "../../../src/renderer/opencode/code-review.ts";
import { ImagePreview } from "../../../src/renderer/ui/ImagePreview.tsx";
import {
  annotations,
  browserAnnotation,
  files,
  reviewComments,
} from "../../attachment-fixtures.ts";
import "./tiles.css";

type Detail = number | "annotation" | "browser";

/** A story-only comparison of attachment tiles inside a transcript message. */
export function TilesOption() {
  const [selected, setSelected] = createSignal<Detail | undefined>();
  const toggle = (detail: Detail) =>
    setSelected((current) => (current === detail ? undefined : detail));
  const image = files[0]!;
  const detailId = createUniqueId();

  return (
    <section class="att-tiles" role="group" aria-label="Attachments">
      <div class="att-tiles-grid">
        <For each={reviewComments}>
          {(comment, index) => {
            const key = index();
            const name = comment.path.split("/").at(-1)!;
            return (
              <button
                type="button"
                class="att-tiles-tile att-tiles-comment"
                classList={{ "att-tiles-selected": selected() === key }}
                aria-expanded={selected() === key}
                aria-controls={detailId}
                onClick={() => toggle(key)}
              >
                <Icon name="code" size="small" aria-hidden="true" />
                <span class="att-tiles-copy">
                  <span class="att-tiles-name">{name}</span>
                  <small>Review comment</small>
                </span>
              </button>
            );
          }}
        </For>
        <button
          type="button"
          class="att-tiles-tile att-tiles-comment"
          classList={{ "att-tiles-selected": selected() === "annotation" }}
          aria-expanded={selected() === "annotation"}
          aria-controls={detailId}
          onClick={() => toggle("annotation")}
        >
          <Icon name="comment" size="small" aria-hidden="true" />
          <span class="att-tiles-copy">
            <span class="att-tiles-name">Earlier response</span>
            <small>Transcript comment</small>
          </span>
        </button>
        <button
          type="button"
          class="att-tiles-tile att-tiles-comment"
          classList={{ "att-tiles-selected": selected() === "browser" }}
          aria-expanded={selected() === "browser"}
          aria-controls={detailId}
          onClick={() => toggle("browser")}
        >
          <Icon name="globe" size="small" aria-hidden="true" />
          <span class="att-tiles-copy">
            <span class="att-tiles-name">Pricing</span>
            <small>Browser comment</small>
          </span>
        </button>
        <div class="att-tiles-tile att-tiles-image">
          <ImagePreview
            src={`data:${image.mime};base64,${image.data}`}
            alt={image.name!}
            class="att-tiles-thumbnail"
          />
          <span class="att-tiles-copy">
            <span class="att-tiles-name">{image.name}</span>
            <small>Image · PNG</small>
          </span>
        </div>
        <For each={files.slice(1)}>
          {(file) => (
            <div class="att-tiles-tile att-tiles-file">
              <FileIcon node={{ path: file.name!, type: "file" }} mono aria-hidden="true" />
              <span class="att-tiles-copy">
                <span class="att-tiles-name">{file.name}</span>
                <small>{file.mime === "application/pdf" ? "PDF file" : "Text file"}</small>
              </span>
            </div>
          )}
        </For>
      </div>
      <Show when={selected() !== undefined}>
        <div id={detailId} class="att-tiles-detail" aria-label="Attachment detail">
          <Switch>
            <Match when={selected() === 0 || selected() === 1}>
              {(() => {
                const comment = () => reviewComments[selected() === 0 ? 0 : 1]!;
                return (
                  <>
                    <p class="att-tiles-detail-comment">{comment().body}</p>
                    <div class="att-tiles-source">
                      {comment().path} · {formatReviewSelection(comment().selection)}
                    </div>
                    <pre>{comment().selectedCode}</pre>
                  </>
                );
              })()}
            </Match>
            <Match when={selected() === "annotation"}>
              <p class="att-tiles-detail-comment">{annotations[0]!.body}</p>
              <blockquote>{annotations[0]!.quote}</blockquote>
            </Match>
            <Match when={selected() === "browser"}>
              <p class="att-tiles-detail-comment">{browserAnnotation.body}</p>
              <div class="att-tiles-source">
                {browserAnnotation.tab.url} · {browserAnnotation.selection.label}
              </div>
              <ImagePreview
                src={`data:${files[0]!.mime};base64,${files[0]!.data}`}
                alt={browserAnnotation.image.name}
                class="att-tiles-browser-image"
              />
            </Match>
          </Switch>
        </div>
      </Show>
    </section>
  );
}
