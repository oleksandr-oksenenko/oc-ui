import { FileDiff as PierreFileDiff } from "@pierre/diffs";
import type {
  DiffLineAnnotation,
  FileDiffOptions,
  PostRenderPhase,
  SelectedLineRange,
} from "@pierre/diffs";
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";

import type { DiffFileReview, ReviewComment } from "../diff-render-data.ts";
import { getAnnotationTarget, getSelectedCode } from "../diff-render-data.ts";
import type { DiffRenderData } from "../diff-render-data.ts";

type AnnotationMetadata = { readonly commentID: string };

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type PierreDiffBodyProps = {
  readonly diff: DiffRenderData;
  readonly path: string;
  readonly review?: DiffFileReview;
};

function enhanceRenderedDiff(node: HTMLElement, phase: PostRenderPhase): void {
  if (phase === "unmount") return;
  const shadow = node.shadowRoot;
  if (!shadow) return;

  for (const code of shadow.querySelectorAll<HTMLElement>("code[data-code]")) {
    code.tabIndex = 0;
  }

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

function selectedRange(review: DiffFileReview | undefined): SelectedLineRange | null {
  return review?.selection ?? null;
}

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

function makeAnnotation(comment: ReviewComment, review: DiffFileReview): HTMLElement {
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

function syncGutterCommentIcons(container: HTMLElement): void {
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

export function PierreDiffBody(props: PierreDiffBodyProps) {
  const [host, setHost] = createSignal<HTMLDivElement>();
  const renderer = new PierreFileDiff<AnnotationMetadata>();

  const currentReview = () => props.review;
  const commentsForAnnotations = (diff: DiffRenderData) =>
    currentReview()
      ?.comments.map((comment) => annotationFor(comment, diff))
      .filter(
        (annotation): annotation is DiffLineAnnotation<AnnotationMetadata> =>
          annotation !== undefined,
      ) ?? [];

  // Comment bodies are deliberately absent. Input events update the owner
  // without causing Pierre to replace the textarea and its caret.
  const renderSignature = createMemo(() => {
    const review = currentReview();
    return [
      review === undefined ? "disabled" : "enabled",
      review?.editingCommentID ?? "",
      ...(review?.comments.map((comment) => {
        const endSide = comment.selection.endSide ?? comment.selection.side;
        return `${comment.id}:${comment.selection.start}:${comment.selection.end}:${comment.selection.side ?? ""}:${endSide ?? ""}`;
      }) ?? []),
    ].join("|");
  });

  const findComment = (id: string): ReviewComment | undefined =>
    currentReview()?.comments.find((comment) => comment.id === id);

  const optionsFor = (
    diff: DiffRenderData,
    review: DiffFileReview | undefined,
  ): FileDiffOptions<AnnotationMetadata> => ({
    theme: "github-dark-high-contrast",
    themeType: "dark",
    diffStyle: "unified",
    expandUnchanged: false,
    disableFileHeader: true,
    overflow: "scroll",
    enableGutterUtility: review !== undefined && review.editingCommentID === undefined,
    enableLineSelection: review !== undefined,
    controlledSelection: false,
    lineHoverHighlight: "both",
    unsafeCSS: `
      :host {
        --diffs-font-size: var(--oc-type-code-size);
        --diffs-line-height: var(--oc-type-code-line-height);
        --diffs-bg-selection-override: var(--oc-surface-selected);
      }

      :is(code[data-code], [data-expand-button]):focus-visible {
        outline: var(--oc-focus-ring-outline);
        outline-offset: var(--oc-focus-ring-inset-offset);
      }

      [data-gutter-buffer="annotation"] {
        position: relative;
      }

      .diff-review-gutter-icon {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 14px;
        height: 14px;
        color: var(--oc-text-base);
        pointer-events: none;
      }
    `,
    onGutterUtilityClick: (selection) => {
      if (!review) return;
      const selectedCode = getSelectedCode(diff.fileDiff, selection);
      if (selectedCode !== undefined) review.onBeginComment?.(selection, selectedCode);
    },
    renderAnnotation: (annotation) => {
      const comment = findComment(annotation.metadata.commentID);
      const reviewNow = currentReview();
      return comment && reviewNow ? makeAnnotation(comment, reviewNow) : undefined;
    },
    onPostRender: (container, _instance, phase) => {
      enhanceRenderedDiff(container, phase);
      if (phase !== "unmount") syncGutterCommentIcons(container);
    },
  });

  const render = (diff: DiffRenderData, review: DiffFileReview | undefined): void => {
    const currentHost = host();
    if (!currentHost) return;
    renderer.setOptions(optionsFor(diff, review));
    renderer.render(
      diff.kind === "files"
        ? {
            oldFile: diff.oldFile,
            newFile: diff.newFile,
            lineAnnotations: commentsForAnnotations(diff),
            containerWrapper: currentHost,
          }
        : {
            fileDiff: diff.fileDiff,
            lineAnnotations: commentsForAnnotations(diff),
            containerWrapper: currentHost,
          },
    );
    renderer.setSelectedLines(selectedRange(review), { notify: false });
  };

  createEffect(
    on([host, () => props.diff], ([currentHost, diff]) => {
      if (!currentHost) return;
      render(diff, untrack(currentReview));
    }),
  );

  createEffect(
    on(
      renderSignature,
      () => {
        const currentHost = host();
        if (!currentHost) return;
        const diff = untrack(() => props.diff);
        const review = untrack(currentReview);
        renderer.setOptions(optionsFor(diff, review));
        renderer.setLineAnnotations(commentsForAnnotations(diff));
        renderer.rerender();
        renderer.setSelectedLines(selectedRange(review), { notify: false });
      },
      { defer: true },
    ),
  );

  onCleanup(() => renderer.cleanUp());

  return (
    <div class="pierre-diff-shell">
      <div
        class="pierre-diff-host"
        role="region"
        aria-label={`Changes in ${props.path}`}
        ref={(element) => setHost(element)}
      />
    </div>
  );
}
