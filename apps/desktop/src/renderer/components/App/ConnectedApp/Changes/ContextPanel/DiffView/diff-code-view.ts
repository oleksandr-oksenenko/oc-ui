import type { CodeViewItem, DiffLineAnnotation, FileContents } from "@pierre/diffs";

import type { DiffFileData, DiffReviewView } from "../DiffView.tsx";
import type { DiffRenderData, ReviewComment } from "./diff-render-data.ts";
import { getAnnotationTarget } from "./diff-render-data.ts";

export type AnnotationMetadata = { readonly commentID: string };

export const DIFF_FILE_UNAVAILABLE = "This patch could not be displayed.";

/** Matches the `.diff-file-header` height in ContextPanel.css. */
export const DIFF_HEADER_HEIGHT = 30;
/** Matches `--oc-type-code-line-height` in foundations.css. */
export const DIFF_LINE_HEIGHT = 18;
/**
 * The gap Pierre removes from `[data-code]` when a file header exists. The
 * panel restores it in unsafeCSS, so the item metric must include it too.
 */
export const DIFF_BODY_TOP_PADDING = 8;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function annotationFor(
  comment: ReviewComment,
  diff: DiffRenderData,
): DiffLineAnnotation<AnnotationMetadata> | undefined {
  const target = getAnnotationTarget(diff.fileDiff, comment.selection);
  if (!target) return undefined;
  return {
    side: target.side,
    lineNumber: target.lineNumber,
    metadata: { commentID: comment.id },
  };
}

function commentsForPath(
  review: DiffReviewView | undefined,
  path: string,
): readonly ReviewComment[] {
  return review?.comments.filter((comment) => comment.path === path) ?? [];
}

function selectionKey(selection: { start: number; end: number; side?: string; endSide?: string }) {
  return `${selection.start}:${selection.end}:${selection.side ?? ""}:${selection.endSide ?? ""}`;
}

/**
 * Identity of everything that requires Pierre to render this item again.
 * Comment bodies are deliberately absent: input events update the owner without
 * letting Pierre replace the textarea and its caret.
 */
export function diffItemSignature(input: {
  readonly file: DiffFileData;
  readonly renderData: DiffRenderData | undefined;
  readonly expanded: boolean;
  readonly review: DiffReviewView | undefined;
}): string {
  const review = input.review;
  const comments = commentsForPath(review, input.file.file);
  const editing = comments.some((comment) => comment.id === review?.editingCommentID)
    ? (review?.editingCommentID ?? "")
    : "";
  const selection =
    review?.selectedLines?.path === input.file.file ? review.selectedLines.range : null;
  return [
    input.renderData?.fileDiff.cacheKey ?? `unavailable:${input.file.file}`,
    // The header shows these server values, so they must republish the item
    // even when the patch content itself is unchanged.
    input.file.status,
    `${input.file.additions}:${input.file.deletions}`,
    input.expanded ? "expanded" : "collapsed",
    review === undefined ? "plain" : "review",
    editing,
    selection ? selectionKey(selection) : "",
    ...comments.map((comment) => `${comment.id}:${selectionKey(comment.selection)}`),
  ].join("|");
}

export function createDiffCodeViewItem(input: {
  readonly file: DiffFileData;
  readonly renderData: DiffRenderData | undefined;
  readonly expanded: boolean;
  readonly review: DiffReviewView | undefined;
  readonly version: number;
}): CodeViewItem<AnnotationMetadata> {
  if (input.renderData === undefined) {
    const file: FileContents = {
      name: input.file.file,
      contents: `${DIFF_FILE_UNAVAILABLE}\n`,
      cacheKey: `unavailable:${input.file.file}`,
    };
    return {
      id: input.file.file,
      type: "file",
      file,
      collapsed: !input.expanded,
      version: input.version,
    };
  }

  const annotations = commentsForPath(input.review, input.file.file)
    .map((comment) => annotationFor(comment, input.renderData!))
    .filter(
      (annotation): annotation is DiffLineAnnotation<AnnotationMetadata> =>
        annotation !== undefined,
    );

  return {
    id: input.file.file,
    type: "diff",
    fileDiff: input.renderData.fileDiff,
    annotations,
    collapsed: !input.expanded,
    version: input.version,
  };
}

export function createReviewAnnotation(
  comment: ReviewComment,
  review: DiffReviewView,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-review-annotation";
  wrapper.dataset.commentId = comment.id;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "diff-review-remove";
  remove.setAttribute("aria-label", "Delete review comment");
  remove.textContent = "×";
  remove.addEventListener("click", () => review.onRemoveComment?.(comment.id, remove));
  wrapper.append(remove);

  if (review.editingCommentID === comment.id) {
    const editor = document.createElement("textarea");
    editor.className = "diff-review-editor";
    editor.rows = 2;
    editor.value = comment.body;
    editor.placeholder = "Leave a review comment";
    editor.setAttribute("aria-label", `Comment on ${comment.path}`);
    editor.addEventListener("input", () => {
      review.onUpdateCommentBody?.(comment.id, editor.value);
    });
    editor.addEventListener("keydown", (event) => {
      const finishesComment = event.key === "Escape" || (event.key === "Enter" && !event.shiftKey);
      if (!finishesComment) return;
      event.preventDefault();
      review.onFinishComment?.(comment.id);
    });
    editor.addEventListener("blur", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && wrapper.contains(next)) return;
      review.onFinishComment?.(comment.id);
    });
    wrapper.append(editor);
    queueMicrotask(() => editor.focus());
  } else {
    const text = document.createElement("button");
    text.type = "button";
    text.className = "diff-review-text";
    text.textContent = comment.body;
    text.addEventListener("click", () => review.onEditComment?.(comment.id));
    wrapper.append(text);
  }

  return wrapper;
}

const observedShadowRoots = new WeakSet<ShadowRoot>();

/** Pierre's hover-only gutter button ships without an accessible name. */
function labelGutterUtility(button: Element): void {
  if (button.getAttribute("aria-label") !== null) return;
  button.setAttribute("aria-label", "Add review comment");
}

function observeGutterUtility(shadow: ShadowRoot): void {
  if (observedShadowRoots.has(shadow)) return;
  observedShadowRoots.add(shadow);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("[data-utility-button]")) labelGutterUtility(node);
        for (const button of node.querySelectorAll("[data-utility-button]")) {
          labelGutterUtility(button);
        }
      }
    }
  }).observe(shadow, { childList: true, subtree: true });
}

/** Add keyboard access and truthful labels to Pierre's rendered controls. */
export function enhanceRenderedDiff(node: HTMLElement): void {
  const shadow = node.shadowRoot;
  if (!shadow) return;

  for (const code of shadow.querySelectorAll<HTMLElement>("code[data-code]")) {
    code.tabIndex = 0;
  }

  for (const button of shadow.querySelectorAll<HTMLElement>("[data-utility-button]")) {
    labelGutterUtility(button);
  }
  observeGutterUtility(shadow);

  for (const button of shadow.querySelectorAll<HTMLElement>("[data-expand-button]")) {
    const label = button.hasAttribute("data-expand-all-button")
      ? "Expand all unchanged lines"
      : (() => {
          const direction = button.hasAttribute("data-expand-up")
            ? "above"
            : button.hasAttribute("data-expand-down")
              ? "below"
              : "above and below";
          return `Expand unchanged lines ${direction}`;
        })();
    button.setAttribute("aria-label", label);
    button.tabIndex = 0;
    if (button.dataset.ocuiKeyboardEnabled === "true") continue;
    button.dataset.ocuiKeyboardEnabled = "true";
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      button.click();
    });
  }
}

export function syncGutterCommentIcons(container: HTMLElement): void {
  const root = container.shadowRoot;
  const symbol = document.getElementById("opencode-v2-icon-comment");
  if (!root || !symbol) return;

  root.querySelectorAll(".diff-review-gutter-icon").forEach((icon) => icon.remove());
  root.querySelectorAll('[data-gutter-buffer="annotation"]').forEach((gutter) => {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    icon.classList.add("diff-review-gutter-icon");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("fill", "none");
    icon.setAttribute("aria-hidden", "true");
    icon.append(...Array.from(symbol.childNodes, (node) => node.cloneNode(true)));
    gutter.append(icon);
  });
}
