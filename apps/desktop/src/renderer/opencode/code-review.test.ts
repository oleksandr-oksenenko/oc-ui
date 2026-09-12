import type { JsonValue } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import {
  CODE_REVIEW_METADATA_KEY,
  formatCodeReviewSection,
  readCodeReviewMetadata,
  type SentReviewComment,
} from "./code-review.ts";

const comment = (path: string, body: string): SentReviewComment => ({
  path,
  selection: { start: 4, side: "deletions", end: 5, endSide: "additions" },
  selectedCode: "const before = `one`;\nconst after = `two`;\n",
  body,
});

describe("code-review codec", () => {
  it("formats every file, range, selected code, and comment", () => {
    const first = comment('src/odd "name".ts', "Please preserve this API.");
    const second: SentReviewComment = {
      ...comment("src/second.ts", "Second comment"),
      selection: { start: 10, end: 12 },
      selectedCode: "return second;",
    };
    const text = formatCodeReviewSection([first, second]);

    expect(text).toContain('### Comment 1\nFile: "src/odd \\\"name\\\".ts"');
    expect(text).toContain("Range: old 4 to new 5");
    expect(text).toContain("Selected code:");
    expect(text).toContain("const before = `one`;");
    expect(text).toContain("Please preserve this API.");
    expect(text).toContain("Please fix all code review comments below.");
    const sections = text.split("### Comment ");
    expect(sections).toHaveLength(3);
    expect(sections[1]).toContain(first.selectedCode.trimEnd());
    expect(sections[1]).toContain(first.body);
    expect(sections[1]).not.toContain(second.body);
    expect(sections[2]).toContain('2\nFile: "src/second.ts"');
    expect(sections[2]).toContain("Range: line 10 to line 12");
    expect(sections[2]).toContain(second.selectedCode);
    expect(sections[2]).toContain(second.body);
    expect(sections[2]).not.toContain(first.body);
  });

  it("uses fences longer than any backtick run in selected code or comments", () => {
    const fenced = comment("file.ts", "contains ```` inside");
    const review = [{ ...fenced, selectedCode: "contains ```` inside\n" }];
    const text = formatCodeReviewSection(review);

    expect(text).toContain("`````\ncontains ```` inside\n`````");
  });

  it("reads legacy metadata and normalizes instruction whitespace", () => {
    expect(
      readCodeReviewMetadata({
        [CODE_REVIEW_METADATA_KEY]: reviewValue(1, "Please preserve this API."),
      }),
    ).toEqual({
      kind: "code-review",
      version: 1,
      instruction: "",
      comments: [
        {
          path: "file.ts",
          selection: { start: 4, side: "deletions", end: 5, endSide: "additions" },
          selectedCode: "before",
          body: "Please preserve this API.",
        },
      ],
    });
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
