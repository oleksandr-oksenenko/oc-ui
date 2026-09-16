import type { JsonValue } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import type { TranscriptAnnotation } from "../domain/annotation-drafts.ts";
import { CODE_REVIEW_METADATA_KEY, type SentReviewComment } from "./code-review.ts";
import {
  SESSION_PROMPT_METADATA_KEY,
  createSessionPrompt,
  readSessionPromptMetadata,
} from "./session-prompt.ts";

const review: SentReviewComment = {
  path: "src/app.ts",
  selection: { start: 2, end: 3 },
  selectedCode: "return value;",
  body: "Handle the empty value.",
};

const annotation: TranscriptAnnotation = {
  id: "annotation-1",
  source: {
    messageID: "message-1",
    block: "content/0/text",
    textDigest: "b".repeat(64),
    start: 1,
    end: 6,
  },
  quote: "selected text",
  body: "This needs clarification.",
};

const reviewValue = {
  path: review.path,
  selection: { start: review.selection.start, end: review.selection.end },
  selectedCode: review.selectedCode,
  body: review.body,
} satisfies JsonValue;

const annotationValue = {
  id: annotation.id,
  source: { ...annotation.source },
  quote: annotation.quote,
  body: annotation.body,
} satisfies JsonValue;

describe("session prompt codec", () => {
  it("keeps plain prompts text-only", () => {
    expect(
      createSessionPrompt({ instruction: "  Continue. ", reviewComments: [], annotations: [] }),
    ).toEqual({
      text: "  Continue. ",
    });
  });

  it("composes reviews and transcript annotations under one metadata envelope", () => {
    const prompt = createSessionPrompt({
      instruction: "Fix these carefully.",
      reviewComments: [review],
      annotations: [annotation],
    });

    expect(prompt.text).toContain("Fix these carefully.\n\n## Code review");
    expect(prompt.text).toContain("## Transcript annotations");
    expect(prompt.text.indexOf("Fix these carefully.")).toBe(
      prompt.text.lastIndexOf("Fix these carefully."),
    );
    expect(prompt.text.indexOf(annotation.body)).toBeLessThan(
      prompt.text.indexOf(annotation.quote),
    );
    expect(readSessionPromptMetadata(prompt.metadata)).toEqual({
      instruction: "Fix these carefully.",
      reviewComments: [review],
      annotations: [annotation],
    });
    expect(prompt.metadata?.[CODE_REVIEW_METADATA_KEY]).toBeUndefined();
  });

  it("captures only serializable review fields without retaining mutable draft data", () => {
    const draft = {
      ...review,
      id: "draft-only",
      selection: { start: 2, end: 3, draftOnly: true },
    };
    const prompt = createSessionPrompt({
      instruction: "",
      reviewComments: [draft],
      annotations: [],
    });
    draft.body = "Edited while sending";
    draft.selection.start = 10;

    expect(readSessionPromptMetadata(prompt.metadata)?.reviewComments).toEqual([review]);
    expect(prompt.text).toContain("Range: line 2 to line 3");
    expect(prompt.text).toContain(review.body);
  });

  it("supports annotation-only sends and fences arbitrary backticks", () => {
    const prompt = createSessionPrompt({
      instruction: "",
      reviewComments: [],
      annotations: [{ ...annotation, quote: "contains ```` inside" }],
    });

    expect(prompt.text).toContain("## Transcript annotations");
    expect(prompt.text).toContain("Please address these transcript comments.");
    expect(prompt.text).toContain("`````\ncontains ```` inside\n`````");
    expect(readSessionPromptMetadata(prompt.metadata)?.annotations).toEqual([
      { ...annotation, quote: "contains ```` inside" },
    ]);
  });

  it("reads legacy code-review metadata", () => {
    const metadata = {
      [CODE_REVIEW_METADATA_KEY]: {
        kind: "code-review",
        version: 1,
        instruction: "Legacy instruction",
        comments: [reviewValue],
      },
    } satisfies Record<string, JsonValue>;
    expect(readSessionPromptMetadata(metadata)).toEqual({
      instruction: "Legacy instruction",
      reviewComments: [review],
      annotations: [],
    });
  });

  it("rejects malformed new metadata without falling through to legacy data", () => {
    const malformed = {
      version: 1,
      instruction: "Fix",
      reviewComments: [reviewValue],
      annotations: [{ ...annotationValue, source: { ...annotation.source, end: 1 } }],
    } satisfies JsonValue;
    expect(
      readSessionPromptMetadata({
        [SESSION_PROMPT_METADATA_KEY]: malformed,
        [CODE_REVIEW_METADATA_KEY]: {
          kind: "code-review",
          version: 1,
          instruction: "Legacy",
          comments: [reviewValue],
        },
      }),
    ).toBeUndefined();
  });

  it("rejects blank bodies, duplicate IDs, and extra envelope fields", () => {
    const base = {
      version: 1,
      instruction: "Fix",
      reviewComments: [reviewValue],
      annotations: [annotationValue],
    };
    const values: JsonValue[] = [
      { ...base, reviewComments: [{ ...reviewValue, body: "  " }] },
      { ...base, annotations: [{ ...annotationValue, body: "  " }] },
      { ...base, annotations: [annotationValue, annotationValue] },
      { ...base, unexpected: true },
    ];
    for (const value of values) {
      expect(readSessionPromptMetadata({ [SESSION_PROMPT_METADATA_KEY]: value })).toBeUndefined();
    }
  });
});
