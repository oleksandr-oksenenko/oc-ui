import { Collapsible } from "@opencode/ui/collapsible";
import { FileIcon } from "@opencode/ui/file-icon";
import { Icon } from "@opencode/ui/icon";
import { For, Show, type JSX } from "solid-js";
import { ImagePreview } from "../../src/renderer/ui/ImagePreview.tsx";
import { formatReviewSelection } from "../../src/renderer/opencode/code-review.ts";
import { annotations, browserAnnotation, files, reviewComments } from "../attachment-fixtures.ts";

/** Story-only visual shell. It owns disclosure state, never application data. */
function AttachmentRow(props: {
  readonly icon: JSX.Element;
  readonly title: string;
  readonly meta: string;
  readonly children?: JSX.Element;
  readonly open?: boolean;
}) {
  const label = () => (
    <>
      {props.icon}
      <span class="attachment-proposal-label">
        <span>{props.title}</span>
        <small>{props.meta}</small>
      </span>
    </>
  );
  return (
    <Show when={props.children} fallback={<div class="attachment-proposal-row">{label()}</div>}>
      <Collapsible class="attachment-proposal-disclosure" defaultOpen={props.open ?? false}>
        <Collapsible.Trigger class="attachment-proposal-row">
          {label()}
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content class="attachment-proposal-detail">
          {props.children}
        </Collapsible.Content>
      </Collapsible>
    </Show>
  );
}

export function AttachmentProposal(props: {
  readonly expanded?: boolean;
  readonly browser?: boolean;
  readonly only?: boolean;
  readonly many?: boolean;
}) {
  return (
    <main class="attachment-study">
      <header class="attachment-study-heading">
        <p>Design proposal · Transcript attachments</p>
        <h1>One place for the context.</h1>
        <p>Consistent rows. Details when you need them.</p>
      </header>
      <div class="attachment-proposal-conversation">
        <p class="attachment-proposal-assistant">
          The draft currently clears when sending starts. I can update that behavior and review the
          surrounding flow.
        </p>
        <article class="attachment-proposal-message" aria-label="Your message">
          <Show when={!props.only}>
            <div class="attachment-proposal-instruction">
              Please address this feedback and use the attached reference.
            </div>
          </Show>
          <section class="attachment-proposal-stack" aria-label="Attachments">
            <div class="attachment-proposal-heading">
              Attached context <span>Sent with this message</span>
            </div>
            <AttachmentRow
              icon={<Icon name="code" size="small" aria-hidden="true" />}
              title="Code review"
              meta="2 comments · 2 files"
              open={props.expanded}
            >
              <For each={reviewComments}>
                {(comment) => (
                  <section class="attachment-proposal-comment">
                    <p>{comment.body}</p>
                    <div class="attachment-proposal-source">
                      <span>{comment.path}</span>
                      <span>{formatReviewSelection(comment.selection)}</span>
                    </div>
                    <pre>{comment.selectedCode}</pre>
                  </section>
                )}
              </For>
            </AttachmentRow>
            <AttachmentRow
              icon={<Icon name="comment" size="small" aria-hidden="true" />}
              title="Transcript annotation"
              meta="1 comment · Earlier response"
              open={props.expanded}
            >
              <p>{annotations[0]!.body}</p>
              <blockquote>{annotations[0]!.quote}</blockquote>
            </AttachmentRow>
            <Show when={props.browser}>
              <AttachmentRow
                icon={<Icon name="globe" size="small" aria-hidden="true" />}
                title="Browser annotation"
                meta="1 comment · Pricing"
                open={props.expanded}
              >
                <p>{browserAnnotation.body}</p>
                <div class="attachment-proposal-source">
                  <span>{browserAnnotation.tab.url}</span>
                  <span>Element · Choose Pro</span>
                </div>
                <ImagePreview
                  src={`data:${files[0]!.mime};base64,${files[0]!.data}`}
                  alt="annotation-1.png"
                  class="attachment-proposal-preview"
                />
                <p class="attachment-proposal-note">
                  Representative image fixture; the captured screenshot belongs here.
                </p>
              </AttachmentRow>
            </Show>
            <div class="attachment-proposal-row attachment-proposal-image-row">
              <ImagePreview
                src={`data:${files[0]!.mime};base64,${files[0]!.data}`}
                alt="composer-reference.png"
                class="attachment-proposal-thumbnail"
              />
              <span class="attachment-proposal-label">
                <span>composer-reference.png</span>
                <small>Image · PNG · Select thumbnail to enlarge</small>
              </span>
            </div>
            <For each={files.slice(1)}>
              {(file) => (
                <AttachmentRow
                  icon={
                    <FileIcon node={{ path: file.name!, type: "file" }} mono aria-hidden="true" />
                  }
                  title={file.name!}
                  meta={file.mime === "application/pdf" ? "File · PDF" : "File · Text"}
                />
              )}
            </For>
            <Show when={props.many}>
              <AttachmentRow
                icon={<Icon name="task" size="small" aria-hidden="true" />}
                title="12 more files"
                meta="Show all attached files"
              >
                <For
                  each={Array.from(
                    { length: 12 },
                    (_, index) => `acceptance-result-${index + 1}.txt`,
                  )}
                >
                  {(name) => (
                    <div class="attachment-proposal-extra-file">
                      {name}
                      <small>File · Text</small>
                    </div>
                  )}
                </For>
              </AttachmentRow>
            </Show>
          </section>
        </article>
        <p class="attachment-proposal-assistant">
          I’ll preserve the draft until receipt is confirmed and keep the work owned by the session.
        </p>
      </div>
      <Show when={props.browser}>
        <aside class="attachment-proposal-caveat">
          Future browser treatment: requires structured browser annotation metadata. Existing
          history must keep its original text and screenshots.
        </aside>
      </Show>
    </main>
  );
}
