import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { For, Show } from "solid-js";
import { BrowserAnnotationThumbnail } from "./BrowserAnnotations/BrowserAnnotationThumbnail.tsx";
import { MAX_ANNOTATIONS, type BrowserAnnotationDraft } from "./browser-annotations.ts";
import type { SessionBrowser, SessionBrowserState } from "./createSessionBrowser.ts";

export type BrowserAnnotationsController = Pick<
  SessionBrowser,
  | "annotations"
  | "annotate"
  | "cancelAnnotation"
  | "annotationBody"
  | "discardAnnotation"
  | "clearAnnotations"
  | "addAnnotations"
>;

export type BrowserAnnotationsProps = {
  readonly controller: BrowserAnnotationsController;
  readonly state: SessionBrowserState;
};

export function BrowserAnnotations(props: BrowserAnnotationsProps) {
  const annotation = () => props.controller.annotations();
  const tab = () => {
    const browser = props.state.browser;
    return browser.tabs.find((item) => item.id === browser.focusedTabID);
  };
  const picking = () => annotation().status !== "idle";
  const ready = () => props.state.status === "connected" && tab() !== undefined && !picking();
  const items = () => annotation().items;
  const sendable = () => items().length > 0 && items().every((item) => item.body.trim().length > 0);
  const stale = (item: BrowserAnnotationDraft) => {
    const current = tab();
    return item.tab.generation !== current?.generation || item.tab.url !== current?.url;
  };
  return (
    <section class="browser-annotations" aria-label="Browser annotations">
      <div class="browser-annotation-actions">
        <Button
          size="small"
          disabled={!ready() || items().length >= MAX_ANNOTATIONS}
          onClick={() => props.controller.annotate("element")}
        >
          Annotate
        </Button>
        <Button
          size="small"
          disabled={!ready() || items().length >= MAX_ANNOTATIONS}
          onClick={() => props.controller.annotate("area")}
        >
          Select area
        </Button>
        <Show when={picking()}>
          <Button size="small" onClick={props.controller.cancelAnnotation}>
            Cancel selection
          </Button>
          <span class="browser-annotation-status" role="status">
            Click an element, drag to select an area, or press Escape.
          </span>
        </Show>
      </div>
      <Show when={items().length > 0}>
        <ul class="browser-annotation-list">
          <For each={items()}>
            {(item) => (
              <li class="browser-annotation-card">
                <div class="browser-annotation-card-head">
                  <span class="browser-annotation-number">{item.number}</span>
                  <BrowserAnnotationThumbnail image={item.image} />
                  <div class="browser-annotation-meta">
                    <span class="browser-annotation-target">
                      {item.mode === "area"
                        ? "Selected area"
                        : item.selection.selector || item.selection.tag}
                    </span>
                    <Show when={!item.selection.topFrame}>
                      <span class="browser-annotation-warning" role="status">
                        Frame selection — comment here; the screenshot has no outline.
                      </span>
                    </Show>
                    <Show when={stale(item)}>
                      <span class="browser-annotation-warning" role="status">
                        Captured before the latest navigation.
                      </span>
                    </Show>
                  </div>
                  <IconButton
                    size="small"
                    variant="ghost-muted"
                    icon={<Icon name="close" size="small" />}
                    aria-label={`Discard annotation ${item.number}`}
                    onClick={() => props.controller.discardAnnotation(item.id)}
                  />
                </div>
                <textarea
                  // A child-frame capture has no popover, so its newest empty
                  // draft takes focus; the in-page popover keeps focus otherwise.
                  autofocus={item.body.length === 0 && item.id === items().at(-1)?.id}
                  aria-label={`Annotation ${item.number} comment`}
                  placeholder="Describe the change…"
                  value={item.body}
                  onInput={(event) =>
                    props.controller.annotationBody(item.id, event.currentTarget.value)
                  }
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={items().length > 0}>
        <div class="browser-annotation-actions">
          <Button
            size="small"
            disabled={!sendable() || picking()}
            onClick={props.controller.addAnnotations}
          >
            Add to composer
          </Button>
          <Button size="small" disabled={picking()} onClick={props.controller.clearAnnotations}>
            Clear
          </Button>
          <span class="browser-annotation-status">
            Add comments, then send them from the conversation composer.
          </span>
        </div>
      </Show>
      <Show when={annotation().error}>
        {(error) => (
          <p class="browser-annotation-error" role="alert">
            {error()}
          </p>
        )}
      </Show>
    </section>
  );
}
