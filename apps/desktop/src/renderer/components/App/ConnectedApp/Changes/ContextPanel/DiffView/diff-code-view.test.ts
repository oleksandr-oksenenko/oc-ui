import type { FileDiffInfo } from "@opencode/client";
import { describe, expect, it, vi } from "vite-plus/test";

import type { DiffReviewView } from "../DiffView.tsx";
import {
  createDiffCodeViewItem,
  createReviewAnnotation,
  diffItemSignature,
  enhanceRenderedDiff,
  syncGutterCommentIcons,
  DIFF_FILE_UNAVAILABLE,
} from "./diff-code-view.ts";
import { prepareDiffRender } from "./diff-render-data.ts";

const file = (overrides: Partial<FileDiffInfo> = {}): FileDiffInfo => ({
  file: overrides.file ?? "src/example.ts",
  additions: overrides.additions ?? 1,
  deletions: overrides.deletions ?? 1,
  status: overrides.status ?? "modified",
  patch: overrides.patch ?? "@@ -1 +1 @@\n-old\n+new\n",
});

const review = (overrides: Partial<DiffReviewView> = {}): DiffReviewView => ({
  comments: [],
  ...overrides,
});

describe("diffItemSignature", () => {
  const prepared = prepareDiffRender(file());
  const base = {
    file: file(),
    renderData: prepared,
    expanded: true,
    review: review({
      comments: [
        {
          id: "comment-1",
          path: "src/example.ts",
          body: "First body",
          selection: { start: 1, side: "additions", end: 1 },
          selectedCode: "new\n",
        },
      ],
    }),
  };

  it("is stable while only a comment body changes", () => {
    const edited = {
      ...base,
      review: review({
        comments: [{ ...base.review.comments[0]!, body: "Second body" }],
      }),
    };
    expect(diffItemSignature(edited)).toBe(diffItemSignature(base));
  });

  it("changes with content, expansion, review presence, and annotation selection", () => {
    expect(diffItemSignature({ ...base, expanded: false })).not.toBe(diffItemSignature(base));
    expect(diffItemSignature({ ...base, review: undefined })).not.toBe(diffItemSignature(base));
    expect(
      diffItemSignature({
        ...base,
        review: review({
          comments: [{ ...base.review.comments[0]!, selection: { start: 2, end: 2 } }],
        }),
      }),
    ).not.toBe(diffItemSignature(base));
    expect(
      diffItemSignature({
        ...base,
        renderData: prepareDiffRender(file({ patch: "@@ -1 +1 @@\n-old\n+changed\n" })),
      }),
    ).not.toBe(diffItemSignature(base));
  });

  it("changes when only the server totals or status change", () => {
    expect(diffItemSignature({ ...base, file: file({ additions: 5 }) })).not.toBe(
      diffItemSignature(base),
    );
    expect(diffItemSignature({ ...base, file: file({ status: "deleted" }) })).not.toBe(
      diffItemSignature(base),
    );
  });

  it("keeps the editing state specific to the file that owns the comment", () => {
    const editing = review({
      comments: base.review.comments,
      editingCommentID: "comment-1",
    });
    expect(diffItemSignature({ ...base, review: editing })).not.toBe(diffItemSignature(base));
    expect(diffItemSignature({ ...base, review: review({ comments: base.review.comments }) })).toBe(
      diffItemSignature(base),
    );
  });
});

describe("createDiffCodeViewItem", () => {
  it("projects parsed metadata, per-path annotations, and collapse state", () => {
    const item = createDiffCodeViewItem({
      file: file(),
      renderData: prepareDiffRender(file()),
      expanded: false,
      review: review({
        comments: [
          {
            id: "comment-1",
            path: "src/example.ts",
            body: "Mine",
            selection: { start: 1, side: "additions", end: 1 },
            selectedCode: "new\n",
          },
          {
            id: "comment-other",
            path: "src/other.ts",
            body: "Theirs",
            selection: { start: 1, side: "additions", end: 1 },
            selectedCode: "new\n",
          },
        ],
      }),
      version: 7,
    });

    expect(item).toMatchObject({
      id: "src/example.ts",
      type: "diff",
      collapsed: true,
      version: 7,
      annotations: [{ side: "additions", lineNumber: 1, metadata: { commentID: "comment-1" } }],
    });
  });

  it("drops annotations whose selection no longer maps to a rendered line", () => {
    const item = createDiffCodeViewItem({
      file: file(),
      renderData: prepareDiffRender(file()),
      expanded: true,
      review: review({
        comments: [
          {
            id: "comment-1",
            path: "src/example.ts",
            body: "Gone",
            selection: { start: 99, side: "additions", end: 99 },
            selectedCode: "new\n",
          },
        ],
      }),
      version: 1,
    });

    expect(item.type === "diff" && item.annotations).toEqual([]);
  });

  it("keeps an unrenderable patch as a fallback file item in place", () => {
    const item = createDiffCodeViewItem({
      file: file({ file: "README.md", patch: "", additions: 0, deletions: 0 }),
      renderData: undefined,
      expanded: true,
      review: review(),
      version: 3,
    });

    expect(item).toMatchObject({
      id: "README.md",
      type: "file",
      collapsed: false,
      version: 3,
      file: { name: "README.md", contents: `${DIFF_FILE_UNAVAILABLE}\n` },
    });
  });
});

describe("createReviewAnnotation", () => {
  it("renders an editable comment and forwards its controls", () => {
    const onEditComment = vi.fn<(commentID: string) => void>();
    const onRemoveComment = vi.fn<(commentID: string, opener: HTMLElement) => void>();
    const annotation = createReviewAnnotation(
      {
        id: "comment-1",
        path: "src/example.ts",
        body: "Use the existing helper.",
        selection: { start: 1, side: "additions", end: 1 },
        selectedCode: "new\n",
      },
      review({ onEditComment, onRemoveComment }),
    );

    expect(annotation.dataset.commentId).toBe("comment-1");
    expect(annotation.querySelector(".diff-review-text")?.textContent).toBe(
      "Use the existing helper.",
    );
    annotation.querySelector<HTMLButtonElement>(".diff-review-text")?.click();
    expect(onEditComment).toHaveBeenCalledWith("comment-1");
    const remove = annotation.querySelector<HTMLButtonElement>(".diff-review-remove");
    remove?.click();
    expect(onRemoveComment).toHaveBeenCalledWith("comment-1", remove);
  });

  it("autosaves the inline editor and finishes on Enter, Escape, or blur", () => {
    const onUpdateCommentBody = vi.fn<(commentID: string, body: string) => void>();
    const onFinishComment = vi.fn<(commentID: string) => void>();
    const annotation = createReviewAnnotation(
      {
        id: "comment-1",
        path: "src/example.ts",
        body: "Draft",
        selection: { start: 1, side: "additions", end: 1 },
        selectedCode: "new\n",
      },
      review({ editingCommentID: "comment-1", onUpdateCommentBody, onFinishComment }),
    );

    const editor = annotation.querySelector<HTMLTextAreaElement>("textarea");
    expect(editor?.value).toBe("Draft");
    expect(editor?.getAttribute("aria-label")).toBe("Comment on src/example.ts");
    editor!.value = "Autosaved body";
    editor?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(onUpdateCommentBody).toHaveBeenCalledWith("comment-1", "Autosaved body");

    const newline = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      shiftKey: true,
    });
    editor!.dispatchEvent(newline);
    expect(newline.defaultPrevented).toBe(false);
    expect(onFinishComment).not.toHaveBeenCalled();

    const save = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    editor!.dispatchEvent(save);
    expect(save.defaultPrevented).toBe(true);
    expect(onFinishComment).toHaveBeenCalledWith("comment-1");

    editor?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(onFinishComment).toHaveBeenCalledTimes(2);

    editor?.dispatchEvent(new FocusEvent("blur", { relatedTarget: document.body }));
    expect(onFinishComment).toHaveBeenCalledTimes(3);
  });
});

describe("enhanceRenderedDiff", () => {
  it("adds keyboard access and truthful labels to Pierre's controls", () => {
    const container = document.createElement("div");
    const shadow = container.attachShadow({ mode: "open" });
    const code = document.createElement("code");
    code.dataset.code = "";
    const above = document.createElement("button");
    above.dataset.expandButton = "";
    above.dataset.expandUp = "";
    const all = document.createElement("button");
    all.dataset.expandButton = "";
    all.dataset.expandAllButton = "";
    const utility = document.createElement("button");
    utility.dataset.utilityButton = "";
    shadow.append(code, above, all, utility);

    enhanceRenderedDiff(container);

    expect(code.tabIndex).toBe(0);
    expect(above.getAttribute("aria-label")).toBe("Expand unchanged lines above");
    expect(all.getAttribute("aria-label")).toBe("Expand all unchanged lines");
    expect(utility.getAttribute("aria-label")).toBe("Add review comment");
    expect(above.tabIndex).toBe(0);

    const click = vi.spyOn(above, "click");
    above.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("labels a gutter utility button that appears after a render", async () => {
    const container = document.createElement("div");
    const shadow = container.attachShadow({ mode: "open" });
    enhanceRenderedDiff(container);

    const utility = document.createElement("button");
    utility.dataset.utilityButton = "";
    shadow.append(utility);

    await vi.waitFor(() => {
      expect(utility.getAttribute("aria-label")).toBe("Add review comment");
    });
  });
});

describe("syncGutterCommentIcons", () => {
  it("clones the app comment symbol into every annotation gutter once", () => {
    const container = document.createElement("div");
    const shadow = container.attachShadow({ mode: "open" });
    const gutter = document.createElement("div");
    gutter.dataset.gutterBuffer = "annotation";
    shadow.append(gutter);
    const symbol = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
    symbol.id = "opencode-v2-icon-comment";
    symbol.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
    document.body.append(symbol);

    syncGutterCommentIcons(container);
    syncGutterCommentIcons(container);

    expect(shadow.querySelectorAll(".diff-review-gutter-icon")).toHaveLength(1);
    symbol.remove();
  });
});
