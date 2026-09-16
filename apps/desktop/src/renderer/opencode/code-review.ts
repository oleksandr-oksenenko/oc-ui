import type { JsonValue } from "@opencode/client";
import { Schema } from "effect";
import type { SelectedLineRange } from "@pierre/diffs";

import { renderFence } from "./prompt-format.ts";

export const CODE_REVIEW_METADATA_KEY = "oc-ui/code-review" as const;

export type SentReviewComment = {
  readonly path: string;
  readonly selection: SelectedLineRange;
  readonly selectedCode: string;
  readonly body: string;
};

export type SentCodeReview = {
  readonly kind: "code-review";
  readonly version: 1;
  readonly instruction: string;
  readonly comments: readonly SentReviewComment[];
};

type MutableSelection = Pick<SelectedLineRange, "start" | "side" | "end" | "endSide">;

const PositiveLineNumberSchema = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0));
const ReviewSideSchema = Schema.Union([Schema.Literal("deletions"), Schema.Literal("additions")]);
const ReviewSelectionSchema = Schema.Struct({
  start: PositiveLineNumberSchema,
  side: Schema.optionalKey(ReviewSideSchema),
  end: PositiveLineNumberSchema,
  endSide: Schema.optionalKey(ReviewSideSchema),
});
export const SentReviewCommentSchema = Schema.Struct({
  path: Schema.String,
  selection: ReviewSelectionSchema,
  selectedCode: Schema.String,
  body: Schema.String,
});
const SentCodeReviewSchema = Schema.Struct({
  kind: Schema.Literal("code-review"),
  version: Schema.Literal(1),
  instruction: Schema.String,
  comments: Schema.NonEmptyArray(SentReviewCommentSchema),
});
const decodeSentCodeReview = Schema.decodeUnknownSync(SentCodeReviewSchema, {
  onExcessProperty: "error",
});

/** Formats the review section shared by review-only and combined prompts. */
export function formatCodeReviewSection(comments: readonly SentReviewComment[]): string {
  const sections = [
    "## Code review",
    "",
    "Please fix all code review comments below.",
    ...comments.flatMap((comment, index) => [
      "",
      `### Comment ${index + 1}`,
      `File: ${JSON.stringify(comment.path)}`,
      "",
      `Range: ${formatReviewSelection(comment.selection)}`,
      "",
      "Selected code:",
      "",
      renderFence(comment.selectedCode),
      "",
      "Comment:",
      "",
      renderFence(comment.body),
    ]),
  ];
  return sections.join("\n");
}

export function readCodeReviewMetadata(
  metadata: Record<string, JsonValue> | undefined,
): SentCodeReview | undefined {
  const value = metadata?.[CODE_REVIEW_METADATA_KEY];
  if (value === undefined) return undefined;
  try {
    const review = decodeSentCodeReview(value);
    return { ...review, instruction: review.instruction.trim() };
  } catch {
    return undefined;
  }
}

export function reviewCommentsToJson(comments: readonly SentReviewComment[]): JsonValue {
  return comments.map((comment) => ({
    path: comment.path,
    selection: toJsonSelection(comment.selection),
    selectedCode: comment.selectedCode,
    body: comment.body,
  }));
}

function toJsonSelection(selection: SelectedLineRange): JsonValue {
  const value: MutableSelection = { start: selection.start, end: selection.end };
  if (selection.side !== undefined) value.side = selection.side;
  if (selection.endSide !== undefined) value.endSide = selection.endSide;
  return value;
}

export function formatReviewSelection(selection: SelectedLineRange): string {
  return `${formatPoint(selection.start, selection.side)} to ${formatPoint(
    selection.end,
    selection.endSide ?? selection.side,
  )}`;
}

function formatPoint(line: number, side: SelectedLineRange["side"]): string {
  return `${side === "deletions" ? "old" : side === "additions" ? "new" : "line"} ${line}`;
}
