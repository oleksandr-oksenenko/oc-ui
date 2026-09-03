import type { JsonValue } from "@opencode-ai/client";
import { Schema } from "effect";
import type { SelectedLineRange } from "@pierre/diffs";

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

export type CodeReviewPrompt = {
  readonly text: string;
  readonly metadata: Record<string, JsonValue>;
};

type CodeReviewPromptInput = {
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
const SentReviewCommentSchema = Schema.Struct({
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

export function createCodeReviewPrompt(input: CodeReviewPromptInput): CodeReviewPrompt {
  const instruction = input.instruction.trim();
  const review = {
    kind: "code-review",
    version: 1,
    instruction,
    comments: input.comments.map(toSentReviewComment),
  } satisfies SentCodeReview;
  const sections = [
    ...(instruction ? [instruction, ""] : []),
    "## Code review",
    "",
    "Please fix all code review comments below.",
    ...review.comments.flatMap((comment, index) => [
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

  return {
    text: sections.join("\n"),
    metadata: { [CODE_REVIEW_METADATA_KEY]: review },
  };
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

function toSentReviewComment(comment: SentReviewComment) {
  return {
    path: comment.path,
    selection: cloneSelection(comment.selection),
    selectedCode: comment.selectedCode,
    body: comment.body,
  };
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

function renderFence(content: string): string {
  const longestRun =
    content.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0) ?? 0;
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${content}${content.endsWith("\n") ? "" : "\n"}${fence}`;
}

function cloneSelection(selection: SelectedLineRange): MutableSelection {
  const clone: MutableSelection = { start: selection.start, end: selection.end };
  if (selection.side !== undefined) clone.side = selection.side;
  if (selection.endSide !== undefined) clone.endSide = selection.endSide;
  return clone;
}
