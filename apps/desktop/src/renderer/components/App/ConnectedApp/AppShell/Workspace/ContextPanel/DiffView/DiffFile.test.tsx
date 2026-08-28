import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileDiff as PierreFileDiff } from "@pierre/diffs";

import { DiffFile, parseFilePatch } from "./DiffFile.tsx";
import { prepareDiffRender, reconstructCompleteFiles } from "./diff-render-data.ts";

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

  it("renders collapsed context that Pierre can expand on click", async () => {
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
      expect(shadow?.querySelector("[data-expand-button]")).not.toBeNull();
    });
    const before = shadow?.querySelectorAll("[data-line]").length ?? 0;
    shadow?.querySelector<HTMLElement>("[data-expand-button]")?.click();
    await vi.waitFor(() => {
      expect(shadow?.querySelectorAll("[data-line]").length).toBeGreaterThan(before);
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
