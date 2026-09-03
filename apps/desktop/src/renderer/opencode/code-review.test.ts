import type { JsonValue } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import {
  CODE_REVIEW_METADATA_KEY,
  createCodeReviewPrompt,
  readCodeReviewMetadata,
  type SentReviewComment,
} from "./code-review.ts";

const comment = (path: string, body: string): SentReviewComment => ({
  path,
  selection: { start: 4, side: "deletions", end: 5, endSide: "additions" },
  selectedCode: "const before = `one`;\nconst after = `two`;\n",
  body,
});

describe("code-review prompt codec", () => {
  it("includes the instruction and every file, range, selected code, and comment", () => {
    const first = comment('src/odd "name".ts', "Please preserve this API.");
    const second = comment("src/second.ts", "Second comment");
    const prompt = createCodeReviewPrompt({
      instruction: "Fix these carefully.",
      comments: [first, second],
    });

    expect(prompt.text).toContain("Fix these carefully.\n\n## Code review");
    expect(prompt.text).toContain('### Comment 1\nFile: "src/odd \\\"name\\\".ts"');
    expect(prompt.text).toContain("Range: old 4 to new 5");
    expect(prompt.text).toContain("Selected code:");
    expect(prompt.text).toContain("const before = `one`;");
    expect(prompt.text).toContain("Please preserve this API.");
    expect(prompt.text).toContain("Please fix all code review comments below.");
    expect(readCodeReviewMetadata(prompt.metadata)).toEqual({
      kind: "code-review",
      version: 1,
      instruction: "Fix these carefully.",
      comments: [first, second],
    });
  });

  it("uses fences longer than any backtick run in selected code or comments", () => {
    const fenced = comment("file.ts", "contains ```` inside");
    const review = [{ ...fenced, selectedCode: "contains ```` inside\n" }];
    const prompt = createCodeReviewPrompt({ instruction: "", comments: review });

    expect(prompt.text).toContain("`````\ncontains ```` inside\n`````");
  });

  it("captures only serializable comment fields without retaining mutable draft data", () => {
    const draft = {
      ...comment("file.ts", "Original comment"),
      id: "draft-only",
      selection: { start: 2, end: 3, draftOnly: true },
    };
    const prompt = createCodeReviewPrompt({ instruction: "", comments: [draft] });
    draft.body = "Edited while sending";
    draft.selection.start = 10;

    expect(readCodeReviewMetadata(prompt.metadata)?.comments).toEqual([
      {
        path: "file.ts",
        selection: { start: 2, end: 3 },
        selectedCode: draft.selectedCode,
        body: "Original comment",
      },
    ]);
    expect(prompt.text).toContain("Range: line 2 to line 3");
    expect(prompt.text).toContain("Original comment");
  });

  it("normalizes instruction whitespace for the prompt and metadata codec", () => {
    const prompt = createCodeReviewPrompt({
      instruction: " \n  Fix these carefully. \t",
      comments: [comment("file.ts", "Keep this safe.")],
    });

    expect(prompt.text).toContain("Fix these carefully.\n\n## Code review");
    expect(readCodeReviewMetadata(prompt.metadata)?.instruction).toBe("Fix these carefully.");
    expect(
      readCodeReviewMetadata({
        [CODE_REVIEW_METADATA_KEY]: reviewValue(1, "body", false, " \n\t"),
      })?.instruction,
    ).toBe("");
  });

  it("rejects malformed or extended private metadata safely", () => {
    const malformedValues: JsonValue[] = [
      reviewValue(2, "body"),
      reviewValue(1, 42),
      reviewValue(1, "body", true),
      null,
    ];
    for (const value of malformedValues) {
      expect(readCodeReviewMetadata({ [CODE_REVIEW_METADATA_KEY]: value })).toBeUndefined();
    }
  });
});

function reviewValue(
  version: JsonValue,
  body: JsonValue,
  extra = false,
  instruction: JsonValue = "",
): JsonValue {
  const value = {
    kind: "code-review",
    version,
    instruction,
    comments: [
      {
        path: "file.ts",
        selection: { start: 4, side: "deletions", end: 5, endSide: "additions" },
        selectedCode: "before",
        body,
      },
    ],
  } satisfies JsonValue;
  return extra ? { ...value, unexpected: true } : value;
}
