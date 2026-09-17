import type { FileDiffInfo } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { parseFilePatch, prepareDiffRender, reconstructCompleteFiles } from "./diff-render-data.ts";
import { getAnnotationTarget, getSelectedCode } from "./diff-render-data.ts";

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

describe("selection mapping", () => {
  it("captures selected code from normalized metadata", () => {
    const metadata = parseFilePatch(
      file({ patch: "@@ -4,3 +4,3 @@\n context\n-old line\n+new line\n tail\n" }),
    );
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
    const metadata = parseFilePatch(
      file({
        additions: 2,
        deletions: 2,
        patch:
          "@@ -1,4 +1,4 @@\n first\n-second\n-third\n+second changed\n+third changed\n fourth\n",
      }),
    );
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
    const metadata = parseFilePatch(file());
    expect(getSelectedCode(metadata!, { start: 20, end: 20, side: "additions" })).toBeUndefined();
  });
});

describe("complete file boundaries", () => {
  it("does not treat truncated or malformed patches as complete files", () => {
    const truncated = file({
      additions: 0,
      deletions: 0,
      patch: "@@ -1,3 +1,3 @@\n first\n second\n",
    });
    expect(reconstructCompleteFiles(truncated)).toBeUndefined();
    expect(
      reconstructCompleteFiles(file({ patch: "GIT binary patch\nliteral 0\n" })),
    ).toBeUndefined();
    expect(prepareDiffRender(file({ patch: "not a patch" }))).toBeUndefined();
  });

  it("preserves side-specific missing final newlines", () => {
    expect(
      reconstructCompleteFiles(
        file({ patch: "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n" }),
      ),
    ).toMatchObject({
      oldFile: { name: "src/example.ts", contents: "old" },
      newFile: { name: "src/example.ts", contents: "new\n" },
    });
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
