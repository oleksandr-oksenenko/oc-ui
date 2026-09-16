import type { FileDiffInfo } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { parseFilePatch, prepareDiffRender, reconstructCompleteFiles } from "./diff-render-data.ts";

const file = (overrides: Partial<FileDiffInfo> = {}): FileDiffInfo => ({
  file: overrides.file ?? "src/example.ts",
  additions: overrides.additions ?? 1,
  deletions: overrides.deletions ?? 1,
  status: overrides.status ?? "modified",
  patch: overrides.patch ?? "@@ -1 +1 @@\n-old\n+new\n",
});

describe("reconstructCompleteFiles", () => {
  it("reconstructs a contiguous full-context modified file", () => {
    const result = reconstructCompleteFiles(
      file({ patch: "@@ -1,3 +1,3 @@\n first\n-old\n+new\n third\n" }),
    );
    expect(result?.oldFile.contents).toBe("first\nold\nthird\n");
    expect(result?.newFile.contents).toBe("first\nnew\nthird\n");
  });

  it("reconstructs an added file because additions cannot be context-trimmed", () => {
    const result = reconstructCompleteFiles(
      file({
        status: "added",
        additions: 2,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+first\n+second\n",
      }),
    );
    expect(result?.oldFile.contents).toBe("");
    expect(result?.newFile.contents).toBe("first\nsecond\n");
  });

  it("reconstructs a deleted file because deletions cannot be context-trimmed", () => {
    const result = reconstructCompleteFiles(
      file({
        status: "deleted",
        additions: 0,
        deletions: 2,
        patch: "@@ -1,2 +0,0 @@\n-first\n-second\n",
      }),
    );
    expect(result?.oldFile.contents).toBe("first\nsecond\n");
    expect(result?.newFile.contents).toBe("");
  });
});

describe("prepareDiffRender", () => {
  it("keeps a partial patch on the patch-only rendering path", () => {
    const prepared = prepareDiffRender(
      file({ patch: "@@ -20,2 +20,2 @@\n context\n-old\n+new\n" }),
    );
    expect(prepared?.kind).toBe("patch");
  });

  it("exposes non-partial metadata for a reconstructed file", () => {
    const prepared = prepareDiffRender(
      file({ patch: "@@ -1,3 +1,3 @@\n first\n-old\n+new\n third\n" }),
    );
    expect(prepared?.kind).toBe("files");
    expect(prepared?.kind === "files" && prepared.fileDiff.isPartial).toBe(false);
  });
});

describe("cacheKey", () => {
  it("is stable for identical content", () => {
    const input = file({
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "@@ -0,0 +1 @@\n+same\n",
    });
    const first = reconstructCompleteFiles(input);
    const second = reconstructCompleteFiles(input);
    expect(first?.oldFile.cacheKey).toBeDefined();
    expect(first?.oldFile.cacheKey).toBe(second?.oldFile.cacheKey);
    expect(first?.newFile.cacheKey).toBe(second?.newFile.cacheKey);
  });

  it("differs for different content", () => {
    const first = reconstructCompleteFiles(
      file({ status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+alpha\n" }),
    );
    const second = reconstructCompleteFiles(
      file({ status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+beta\n" }),
    );
    expect(first?.newFile.cacheKey).not.toBe(second?.newFile.cacheKey);
  });

  it("keys patch-path metadata by stable patch content", () => {
    const first = parseFilePatch(file());
    const second = parseFilePatch(file());
    const changed = parseFilePatch(file({ patch: "@@ -1 +1 @@\n-old\n+changed\n" }));
    expect(first?.cacheKey).toBeDefined();
    expect(first?.cacheKey).toBe(second?.cacheKey);
    expect(changed?.cacheKey).not.toBe(first?.cacheKey);
  });
});
