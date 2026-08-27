import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileDiff as PierreFileDiff } from "@pierre/diffs";

import { DiffFile, parseFilePatch } from "./DiffFile.tsx";

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

    expect(host.querySelector("diffs-container")).toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="Expand src/example.ts"]')?.click();
    await vi.waitFor(() => expect(host.querySelector("diffs-container")).not.toBeNull());
    expect(renderSpy).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[aria-label="Collapse src/example.ts"]')?.click();
    await vi.waitFor(() => expect(host.querySelector("diffs-container")).toBeNull());
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
    const firstDiff = renderSpy.mock.calls[0]?.[0].fileDiff;
    update({ ...file, patch: file.patch.replace("+new", "+newer") });
    await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(2));
    const secondDiff = renderSpy.mock.calls[1]?.[0].fileDiff;
    expect(secondDiff).not.toBe(firstDiff);
    expect(JSON.stringify(secondDiff)).toContain("newer");
    expect(firstDiff?.cacheKey).toBeUndefined();
    expect(secondDiff?.cacheKey).toBeUndefined();

    dispose();
    host.remove();
    renderSpy.mockRestore();
  });
});
