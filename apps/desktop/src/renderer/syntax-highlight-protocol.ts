import { Schema } from "effect";

export const HighlightSnippet = Schema.Struct({
  code: Schema.String,
  language: Schema.String,
  theme: Schema.Literals(["light", "dark"]),
});
export type HighlightSnippet = typeof HighlightSnippet.Type;

export const HighlightTokens = Schema.Array(
  Schema.Array(
    Schema.Struct({
      content: Schema.String,
      color: Schema.optional(Schema.String),
      fontStyle: Schema.optional(Schema.Finite),
    }),
  ),
);
export type HighlightTokens = typeof HighlightTokens.Type;

export class SyntaxHighlightError extends Schema.TaggedError<SyntaxHighlightError>()(
  "SyntaxHighlightError",
  { cause: Schema.Defect() },
) {}

export const HighlightResponse = Schema.Union([
  Schema.Struct({ tokens: HighlightTokens }),
  Schema.Struct({ error: Schema.String }),
]);
