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
  {
    cause: Schema.Defect(),
    stage: Schema.optional(
      Schema.Literals([
        "construction",
        "posting",
        "worker",
        "message-decoding",
        "response-decoding",
        "tokenizer",
        "response-timeout",
      ]),
    ),
  },
) {
  // Schema errors can contain source/token payloads. Keep the printable failure
  // boundary and cause type, while retaining the complete cause on the error.
  override get message(): string {
    const cause = this.cause instanceof Error ? this.cause.name : "worker-reported failure";
    return `Syntax highlighting failed during ${this.stage ?? "unknown"} (${cause})`;
  }
}

export const HighlightResponse = Schema.Union([
  Schema.Struct({ tokens: HighlightTokens }),
  Schema.Struct({ error: Schema.String }),
]);
