import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileDiff as PierreFileDiff } from "@pierre/diffs";
import type { SelectedLineRange } from "@pierre/diffs";

import { DiffFile, parseFilePatch } from "./DiffFile.tsx";
import {
  getAnnotationTarget,
  getSelectedCode,
  prepareDiffRender,
  reconstructCompleteFiles,
} from "./diff-render-data.ts";

const file = {
  path: "src/example.ts",
  additions: 1,
  deletions: 1,
  status: "modified" as const,
  patch: `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+new
`,
};

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerID = 1,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: 1,
    clientY: 1,
    composed: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerID },
    pointerType: { value: "mouse" },
  });
  target.dispatchEvent(event);
}

describe("DiffFile", () => {
  it("projects a unified patch into Pierre metadata", () => {
    const parsed = parseFilePatch(file);
    expect(parsed).toMatchObject({
      name: "src/example.ts",
      type: "change",
      unifiedLineCount: 2,
    });
    expect(parsed?.hunks).toHaveLength(1);
  });

  it("accepts a headerless single-file patch using the API path", () => {
    const parsed = parseFilePatch({ ...file, patch: "@@ -1 +1 @@\n-old\n+new\n" });
    expect(parsed).toMatchObject({ name: "src/example.ts", type: "change" });
  });

  it("captures selected code from normalized metadata", () => {
    const metadata = parseFilePatch({
      ...file,
      patch: "@@ -4,3 +4,3 @@\n context\n-old line\n+new line\n tail\n",
    });
    expect(metadata).toBeDefined();
    expect(
      getSelectedCode(metadata!, {
        start: 5,
        side: "deletions",
        end: 5,
        endSide: "additions",
      }),
    ).toBe("old line\nnew line\n");
  });

  it("places reverse selections below their visual bottom row", () => {
    const metadata = parseFilePatch({
      ...file,
      additions: 2,
      deletions: 2,
      patch: "@@ -1,4 +1,4 @@\n first\n-second\n-third\n+second changed\n+third changed\n fourth\n",
    });
    expect(metadata).toBeDefined();
    expect(
      getAnnotationTarget(metadata!, {
        start: 3,
        side: "additions",
        end: 2,
        endSide: "deletions",
      }),
    ).toEqual({ side: "additions", lineNumber: 3 });
  });

  it("does not invent selected code for a line absent from normalized metadata", () => {
    const metadata = parseFilePatch(file);
    expect(getSelectedCode(metadata!, { start: 20, end: 20, side: "additions" })).toBeUndefined();
  });

  it("reconstructs complete modified, added, and deleted text files", () => {
    const modified = reconstructCompleteFiles({
      ...file,
      patch: `@@ -1,3 +1,3 @@
 first
-old
+new
 last
`,
    });
    expect(modified).toEqual({
      oldFile: { name: file.path, contents: "first\nold\nlast\n" },
      newFile: { name: file.path, contents: "first\nnew\nlast\n" },
    });

    const added = reconstructCompleteFiles({
      ...file,
      status: "added",
      additions: 2,
      deletions: 0,
      patch: "@@ -0,0 +1,2 @@\n+first\n+second\n",
    });
    expect(added).toEqual({
      oldFile: { name: file.path, contents: "" },
      newFile: { name: file.path, contents: "first\nsecond\n" },
    });

    const deleted = reconstructCompleteFiles({
      ...file,
      status: "deleted",
      additions: 0,
      deletions: 2,
      patch: "@@ -1,2 +0,0 @@\n-first\n-second\n",
    });
    expect(deleted).toEqual({
      oldFile: { name: file.path, contents: "first\nsecond\n" },
      newFile: { name: file.path, contents: "" },
    });
  });

  it("keeps valid partial patches on the patch-only rendering path", () => {
    const partial = prepareDiffRender({
      ...file,
      patch: "@@ -20,2 +20,2 @@\n context\n-old\n+new\n",
    });

    expect(partial?.kind).toBe("patch");
    expect(partial?.kind === "patch" && partial.fileDiff.isPartial).toBe(true);
  });

  it("retains normalized metadata on the complete-file rendering path", () => {
    const prepared = prepareDiffRender(file);
    expect(prepared?.kind).toBe("files");
    expect(prepared?.kind === "files" && prepared.fileDiff.name).toBe(file.path);
    expect(
      prepared?.kind === "files" &&
        getSelectedCode(prepared.fileDiff, {
          start: 1,
          side: "additions",
          end: 1,
        }),
    ).toBe("new\n");
  });

  it("uses Pierre's in-gutter action and autosaving inline editor", async () => {
    const renderSpy = vi.spyOn(PierreFileDiff.prototype, "render").mockReturnValue(true);
    const rerenderSpy = vi.spyOn(PierreFileDiff.prototype, "rerender").mockImplementation(() => {});
    const optionsSpy = vi.spyOn(PierreFileDiff.prototype, "setOptions");
    const annotationsSpy = vi
      .spyOn(PierreFileDiff.prototype, "setLineAnnotations")
      .mockImplementation(() => {});
    const selectionSpy = vi
      .spyOn(PierreFileDiff.prototype, "setSelectedLines")
      .mockImplementation(() => {});
    const onBeginComment = vi.fn<(selection: SelectedLineRange, selectedCode: string) => void>();
    const onUpdateCommentBody = vi.fn<(commentID: string, body: string) => void>();
    const onEditComment = vi.fn<(commentID: string) => void>();
    const onFinishComment = vi.fn<(commentID: string) => void>();
    const onRemoveComment = vi.fn<(commentID: string, opener: HTMLElement) => void>();
    const [editingCommentID, setEditingCommentID] = createSignal<string>();
    const selection = { start: 1, side: "additions", end: 1, endSide: "additions" } as const;
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <DiffFile
          file={file}
          review={{
            comments: [
              {
                id: "comment-1",
                path: file.path,
                body: "Use the existing helper.",
                selection,
                selectedCode: "new\n",
              },
              {
                id: "comment-empty",
                path: file.path,
                body: "",
                selection,
                selectedCode: "new\n",
              },
            ],
            editingCommentID: editingCommentID(),
            selection,
            onBeginComment,
            onUpdateCommentBody,
            onEditComment,
            onFinishComment,
            onRemoveComment,
          }}
        />
      ),
      host,
    );

    await vi.waitFor(() => expect(optionsSpy).toHaveBeenCalled());
    const options = optionsSpy.mock.calls.at(-1)?.[0];
    expect(options).toMatchObject({
      enableGutterUtility: true,
      enableLineSelection: true,
      controlledSelection: false,
    });
    expect(options).not.toHaveProperty("renderGutterUtility");
    options?.onGutterUtilityClick?.(selection);
    expect(onBeginComment).toHaveBeenCalledWith(selection, "new\n");
    expect(host.querySelector(".diff-review-keyboard-add")).toBeNull();

    setEditingCommentID("comment-1");
    await vi.waitFor(() => expect(optionsSpy).toHaveBeenCalledTimes(2));
    const editingOptions = optionsSpy.mock.calls.at(-1)?.[0];
    const annotation = editingOptions?.renderAnnotation?.({
      lineNumber: 1,
      side: "additions",
      metadata: { commentID: "comment-1" },
    });
    const editor = annotation?.querySelector<HTMLTextAreaElement>("textarea");
    expect(editor?.value).toBe("Use the existing helper.");
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

    const save = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    editor!.dispatchEvent(save);
    expect(save.defaultPrevented).toBe(true);
    expect(onFinishComment).toHaveBeenCalledWith("comment-1");
    onFinishComment.mockClear();

    editor?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(onFinishComment).toHaveBeenCalledWith("comment-1");
    onFinishComment.mockClear();
    editor?.dispatchEvent(new FocusEvent("blur", { relatedTarget: host }));
    expect(onFinishComment).toHaveBeenCalledWith("comment-1");
    const remove = annotation?.querySelector<HTMLButtonElement>(
      '[aria-label="Delete review comment"]',
    );
    remove?.click();
    expect(onRemoveComment).toHaveBeenCalledWith("comment-1", remove);

    setEditingCommentID("comment-empty");
    await vi.waitFor(() => expect(optionsSpy).toHaveBeenCalledTimes(3));
    const emptyOptions = optionsSpy.mock.calls.at(-1)?.[0];
    const emptyAnnotation = emptyOptions?.renderAnnotation?.({
      lineNumber: 1,
      side: "additions",
      metadata: { commentID: "comment-empty" },
    });
    expect(emptyAnnotation?.dataset.commentId).toBe("comment-empty");
    emptyAnnotation
      ?.querySelector<HTMLButtonElement>('[aria-label="Delete review comment"]')
      ?.click();
    await Promise.resolve();
    expect(onRemoveComment).toHaveBeenLastCalledWith("comment-empty", expect.any(HTMLElement));

    dispose();
    host.remove();
    renderSpy.mockRestore();
    rerenderSpy.mockRestore();
    optionsSpy.mockRestore();
    annotationsSpy.mockRestore();
    selectionSpy.mockRestore();
  });

  it("syncs comment icons through Pierre's post-render lifecycle", async () => {
    const renderSpy = vi.spyOn(PierreFileDiff.prototype, "render").mockReturnValue(true);
    const optionsSpy = vi.spyOn(PierreFileDiff.prototype, "setOptions");
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <DiffFile file={file} review={{ comments: [] }} />, host);

    await vi.waitFor(() => expect(optionsSpy).toHaveBeenCalled());
    const options = optionsSpy.mock.calls.at(-1)?.[0];
    const instance = new PierreFileDiff();
    const container = document.createElement("div");
    const shadow = container.attachShadow({ mode: "open" });
    const gutter = document.createElement("div");
    gutter.dataset.gutterBuffer = "annotation";
    shadow.append(gutter);
    const symbol = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
    symbol.id = "opencode-v2-icon-comment";
    symbol.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
    document.body.append(symbol);

    if (!options?.onPostRender) throw new Error("Expected Pierre post-render hook");
    options.onPostRender(container, instance, "mount");
    expect(gutter.querySelector(".diff-review-gutter-icon")).not.toBeNull();

    symbol.remove();
    dispose();
    host.remove();
    renderSpy.mockRestore();
    optionsSpy.mockRestore();
  });

  it("keeps Pierre's native gutter drag range for long, reverse, and cross-side reviews", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const exercise = async (
      candidate: Parameters<typeof parseFilePatch>[0],
      startSelector: string,
      endSelector: string,
      expected: SelectedLineRange,
    ): Promise<void> => {
      const onBeginComment = vi.fn<(selection: SelectedLineRange, selectedCode: string) => void>();
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(
        () => (
          <DiffFile
            file={candidate}
            review={{
              comments: [],
              onBeginComment,
            }}
          />
        ),
        host,
      );

      let shadow: ShadowRoot | undefined;
      await vi.waitFor(() => {
        shadow = host.querySelector("diffs-container")?.shadowRoot ?? undefined;
        expect(shadow?.querySelector(startSelector)).not.toBeNull();
        expect(shadow?.querySelector(endSelector)).not.toBeNull();
      });
      const start = shadow!.querySelector<HTMLElement>(startSelector)!;
      const end = shadow!.querySelector<HTMLElement>(endSelector)!;
      let hitTarget: Element = start;
      Object.defineProperty(shadow!, "elementFromPoint", {
        configurable: true,
        value: () => hitTarget,
      });

      dispatchPointer(start, "pointermove");
      const add = shadow!.querySelector<HTMLButtonElement>("[data-utility-button]");
      expect(add).not.toBeNull();
      expect(start.contains(add)).toBe(true);

      dispatchPointer(add!, "pointerdown");
      hitTarget = end;
      dispatchPointer(document, "pointermove");
      dispatchPointer(document, "pointerup");

      expect(onBeginComment).toHaveBeenCalledTimes(1);
      expect(onBeginComment.mock.calls[0]?.[0]).toEqual(expected);
      expect(onBeginComment.mock.calls[0]?.[1]).toEqual(expect.any(String));

      dispose();
      host.remove();
    };

    const additions = Array.from({ length: 8 }, (_, index) => `+line ${index + 1}\n`).join("");
    const added = {
      path: "src/added.ts",
      additions: 8,
      deletions: 0,
      status: "added" as const,
      patch: `@@ -0,0 +1,8 @@\n${additions}`,
    };
    await exercise(added, '[data-column-number="1"]', '[data-column-number="1"]', {
      start: 1,
      side: "additions",
      end: 1,
    });
    await exercise(added, '[data-column-number="1"]', '[data-column-number="6"]', {
      start: 1,
      side: "additions",
      end: 6,
    });
    await exercise(added, '[data-column-number="6"]', '[data-column-number="1"]', {
      start: 6,
      side: "additions",
      end: 1,
    });
    await exercise(
      {
        ...file,
        additions: 2,
        deletions: 2,
        patch:
          "@@ -1,4 +1,4 @@\n first\n-second\n-third\n+second changed\n+third changed\n fourth\n",
      },
      '[data-column-number="2"][data-line-type="change-deletion"]',
      '[data-column-number="3"][data-line-type="change-addition"]',
      { start: 2, side: "deletions", end: 3, endSide: "additions" },
    );

    vi.unstubAllGlobals();
  });

  it("does not treat truncated or malformed patches as complete files", () => {
    const truncated = {
      ...file,
      additions: 0,
      deletions: 0,
      patch: "@@ -1,3 +1,3 @@\n first\n second\n",
    };
    expect(reconstructCompleteFiles(truncated)).toBeUndefined();
    expect(
      reconstructCompleteFiles({ ...file, patch: "GIT binary patch\nliteral 0\n" }),
    ).toBeUndefined();
    expect(prepareDiffRender({ ...file, patch: "not a patch" })).toBeUndefined();
  });

  it("preserves side-specific missing final newlines", () => {
    expect(
      reconstructCompleteFiles({
        ...file,
        patch: "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n",
      }),
    ).toEqual({
      oldFile: { name: file.path, contents: "old" },
      newFile: { name: file.path, contents: "new\n" },
    });
  });

  it("labels collapsed context and lets the keyboard expand it", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const body = Array.from({ length: 20 }, (_, index) => {
      const line = `line ${index + 1}`;
      return index === 10 ? `-${line}\n+changed line\n` : ` ${line}\n`;
    }).join("");
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => <DiffFile file={{ ...file, patch: `@@ -1,20 +1,20 @@\n${body}` }} />,
      host,
    );

    let shadow: ShadowRoot | null | undefined;
    await vi.waitFor(() => {
      shadow = host.querySelector("diffs-container")?.shadowRoot;
      const expandButton = shadow?.querySelector<HTMLElement>("[data-expand-button]");
      expect(expandButton?.getAttribute("aria-label")).toBe("Expand unchanged lines below");
      expect(expandButton?.tabIndex).toBe(0);
      expect(shadow?.querySelector<HTMLElement>("code[data-code]")?.tabIndex).toBe(0);
    });
    const before = shadow?.querySelectorAll("[data-line]").length ?? 0;
    shadow
      ?.querySelector<HTMLElement>("[data-expand-button]")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(shadow?.querySelectorAll("[data-line]").length).toBeGreaterThan(before);
    });

    dispose();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("labels Pierre's chunked expand-all control truthfully", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const body = Array.from({ length: 241 }, (_, index) => {
      const line = `line ${index + 1}`;
      return index === 120 ? `-${line}\n+changed line\n` : ` ${line}\n`;
    }).join("");
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => <DiffFile file={{ ...file, patch: `@@ -1,241 +1,241 @@\n${body}` }} />,
      host,
    );

    await vi.waitFor(() => {
      const shadow = host.querySelector("diffs-container")?.shadowRoot;
      const expandAllButton = shadow?.querySelector<HTMLElement>("[data-expand-all-button]");
      expect(expandAllButton?.getAttribute("aria-label")).toBe("Expand all unchanged lines");
      expect(expandAllButton?.getAttribute("aria-label")).not.toBe(
        "Expand unchanged lines above and below",
      );
    });

    dispose();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows an accessible fallback for an empty patch", () => {
    const host = document.createElement("div");
    const dispose = render(() => <DiffFile file={{ ...file, patch: "" }} />, host);

    expect(host.textContent).toContain("This patch could not be displayed.");
    expect(host.querySelector('[aria-label="Collapse src/example.ts"]')).not.toBeNull();
    dispose();
  });

  it("mounts Pierre when opened and remounts it after closing", async () => {
    const renderSpy = vi.spyOn(PierreFileDiff.prototype, "render").mockImplementation((props) => {
      props.containerWrapper?.append(document.createElement("diffs-container"));
      return true;
    });
    const cleanupSpy = vi.spyOn(PierreFileDiff.prototype, "cleanUp").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <DiffFile file={{ ...file, defaultExpanded: false }} />, host);

    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Expand src/example.ts"]');
    expect(host.querySelector("diffs-container")).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    trigger?.click();
    await vi.waitFor(() => expect(host.querySelector("diffs-container")).not.toBeNull());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(renderSpy).toHaveBeenCalledTimes(1);

    expect(renderSpy.mock.calls[0]?.[0]).toMatchObject({
      oldFile: { name: file.path, contents: "old\n" },
      newFile: { name: file.path, contents: "new\n" },
    });
    expect(renderSpy.mock.calls[0]?.[0].fileDiff).toBeUndefined();

    host.querySelector<HTMLButtonElement>('[aria-label="Collapse src/example.ts"]')?.click();
    await vi.waitFor(() => expect(host.querySelector("diffs-container")).toBeNull());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[aria-label="Expand src/example.ts"]')?.click();
    await vi.waitFor(() => expect(host.querySelector("diffs-container")).not.toBeNull());
    expect(renderSpy).toHaveBeenCalledTimes(2);

    dispose();
    host.remove();
    renderSpy.mockRestore();
    cleanupSpy.mockRestore();
  });

  it("renders new patch content when the same path changes", async () => {
    const renderSpy = vi.spyOn(PierreFileDiff.prototype, "render").mockReturnValue(true);
    const host = document.createElement("div");
    document.body.append(host);
    let update!: (next: typeof file) => void;
    const dispose = render(() => {
      const [current, setCurrent] = createSignal(file);
      update = setCurrent;
      return <DiffFile file={current()} />;
    }, host);

    await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
    const firstNewFile = renderSpy.mock.calls[0]?.[0].newFile;
    update({ ...file, patch: file.patch.replace("+new", "+newer") });
    await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(2));
    const secondNewFile = renderSpy.mock.calls[1]?.[0].newFile;
    expect(secondNewFile).not.toBe(firstNewFile);
    expect(secondNewFile?.contents).toContain("newer");
    expect(firstNewFile?.cacheKey).toBeUndefined();
    expect(secondNewFile?.cacheKey).toBeUndefined();

    dispose();
    host.remove();
    renderSpy.mockRestore();
  });
});
