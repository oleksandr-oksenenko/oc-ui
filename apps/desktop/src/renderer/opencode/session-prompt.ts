import type { JsonValue, PromptSkillAttachment } from "@opencode/client";
import { Schema } from "effect";

import {
  formatCodeReviewSection,
  readCodeReviewMetadata,
  reviewCommentsToJson,
  SentReviewCommentSchema,
  type SentReviewComment,
} from "./code-review.ts";
import {
  TranscriptAnnotationSchema,
  type TranscriptAnnotation,
} from "../domain/annotation-drafts.ts";
import { renderFence } from "./prompt-format.ts";

export const SESSION_PROMPT_METADATA_KEY = "oc-ui/session-prompt" as const;

export type SessionPromptInput = {
  readonly skills?: readonly PromptSkillAttachment[];
  readonly instruction: string;
  readonly reviewComments: readonly SentReviewComment[];
  readonly annotations: readonly TranscriptAnnotation[];
};

export type SessionPrompt = {
  readonly text: string;
  readonly skills?: PromptSkillAttachment[];
  readonly metadata?: Record<string, JsonValue>;
};

type SessionPromptMetadata = {
  readonly version: 1;
  readonly instruction: string;
  readonly reviewComments: readonly SentReviewComment[];
  readonly annotations: readonly TranscriptAnnotation[];
};

const SessionPromptMetadataSchema = Schema.Struct({
  version: Schema.Literal(1),
  instruction: Schema.String,
  reviewComments: Schema.Array(SentReviewCommentSchema),
  annotations: Schema.Array(TranscriptAnnotationSchema),
});
const decodeSessionPromptMetadata = Schema.decodeUnknownSync(SessionPromptMetadataSchema, {
  onExcessProperty: "error",
});

export function createSessionPrompt(input: SessionPromptInput): SessionPrompt {
  const instruction = input.instruction.trim();
  const hasComments = input.reviewComments.length > 0 || input.annotations.length > 0;
  const offset = hasComments ? input.instruction.length - input.instruction.trimStart().length : 0;
  const skills = input.skills?.length
    ? input.skills.map(({ id, name, mention }) => ({
        id,
        name,
        mention: mention
          ? { ...mention, start: mention.start - offset, end: mention.end - offset }
          : undefined,
      }))
    : undefined;
  if (!hasComments)
    return skills ? { text: input.instruction, skills } : { text: input.instruction };

  const sections = [
    ...(instruction ? [instruction, ""] : []),
    ...(input.reviewComments.length > 0 ? [formatCodeReviewSection(input.reviewComments)] : []),
    ...(input.annotations.length > 0 ? [formatAnnotationSection(input.annotations)] : []),
  ];

  const envelope: SessionPromptMetadata = {
    version: 1,
    instruction,
    reviewComments: input.reviewComments,
    annotations: input.annotations,
  };
  return {
    text: sections.join("\n"),
    skills,
    metadata: {
      [SESSION_PROMPT_METADATA_KEY]: toJsonSessionPromptMetadata(envelope),
    },
  };
}

export function readSessionPromptMetadata(metadata: Record<string, JsonValue> | undefined):
  | {
      readonly instruction: string;
      readonly reviewComments: readonly SentReviewComment[];
      readonly annotations: readonly TranscriptAnnotation[];
    }
  | undefined {
  if (metadata !== undefined && Object.hasOwn(metadata, SESSION_PROMPT_METADATA_KEY)) {
    const value = metadata[SESSION_PROMPT_METADATA_KEY];
    if (value === undefined) return undefined;
    try {
      const decoded = decodeSessionPromptMetadata(value);
      if (
        !hasUniqueAnnotationIDs(decoded.annotations) ||
        (decoded.reviewComments.length === 0 && decoded.annotations.length === 0) ||
        decoded.reviewComments.some((comment) => comment.body.trim() === "")
      ) {
        return undefined;
      }
      return {
        instruction: decoded.instruction.trim(),
        reviewComments: decoded.reviewComments,
        annotations: decoded.annotations,
      };
    } catch {
      return undefined;
    }
  }

  const legacy = readCodeReviewMetadata(metadata);
  if (legacy === undefined) return undefined;
  return {
    instruction: legacy.instruction,
    reviewComments: legacy.comments,
    annotations: [],
  };
}

function toJsonSessionPromptMetadata(metadata: SessionPromptMetadata): JsonValue {
  return {
    version: metadata.version,
    instruction: metadata.instruction,
    reviewComments: reviewCommentsToJson(metadata.reviewComments),
    annotations: metadata.annotations.map((annotation) => ({
      id: annotation.id,
      source: {
        messageID: annotation.source.messageID,
        block: annotation.source.block,
        textDigest: annotation.source.textDigest,
        start: annotation.source.start,
        end: annotation.source.end,
      },
      quote: annotation.quote,
      body: annotation.body,
    })),
  };
}

function formatAnnotationSection(annotations: readonly TranscriptAnnotation[]): string {
  return [
    "## Transcript annotations",
    "",
    "Please address these transcript comments.",
    ...annotations.flatMap((annotation, index) => [
      "",
      `### Annotation ${index + 1}`,
      "Comment:",
      "",
      renderFence(annotation.body),
      "",
      `Source message: ${JSON.stringify(annotation.source.messageID)}`,
      `Source block: ${JSON.stringify(annotation.source.block)}`,
      `Source range: ${annotation.source.start} to ${annotation.source.end}`,
      "",
      "Quoted text:",
      "",
      renderFence(annotation.quote),
    ]),
  ].join("\n");
}

function hasUniqueAnnotationIDs(annotations: readonly TranscriptAnnotation[]): boolean {
  const ids = new Set(annotations.map((annotation) => annotation.id));
  return ids.size === annotations.length;
}
