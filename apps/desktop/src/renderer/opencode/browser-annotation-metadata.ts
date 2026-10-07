import type { JsonValue } from "@opencode/client";
import { Schema } from "effect";
import { BrowserSelection } from "../../shared/browser-api.ts";

export const BROWSER_ANNOTATIONS_METADATA_KEY = "oc-ui/browser-annotations";

const SentBrowserAnnotationSchema = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  mode: Schema.Literals(["element", "area"]),
  body: Schema.String,
  url: Schema.String,
  title: Schema.String,
  capturedAt: Schema.String,
  selection: BrowserSelection,
  fileIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type SentBrowserAnnotation = typeof SentBrowserAnnotationSchema.Type;
export type BrowserAnnotationBatch = {
  readonly files: readonly File[];
  readonly annotations: readonly SentBrowserAnnotation[];
};

const BrowserMetadataSchema = Schema.Struct({
  version: Schema.Literal(1),
  instruction: Schema.String,
  annotations: Schema.Array(SentBrowserAnnotationSchema),
});
const decode = Schema.decodeUnknownSync(BrowserMetadataSchema, { onExcessProperty: "error" });

/** Presentation metadata supplements the model-visible prompt text. */
export function browserAnnotationMetadata(
  instruction: string,
  annotations: readonly SentBrowserAnnotation[],
) {
  if (annotations.length === 0) return undefined;
  return {
    [BROWSER_ANNOTATIONS_METADATA_KEY]: {
      version: 1,
      instruction: instruction.trimEnd(),
      annotations: annotations.map((annotation) => ({
        ...annotation,
        selection: { ...annotation.selection, bounds: { ...annotation.selection.bounds } },
      })),
    },
  } satisfies Record<string, JsonValue>;
}

export function readBrowserAnnotationMetadata(metadata: Record<string, JsonValue> | undefined) {
  const value = metadata?.[BROWSER_ANNOTATIONS_METADATA_KEY];
  if (value === undefined) return undefined;
  try {
    const result = decode(value);
    if (
      result.annotations.length === 0 ||
      new Set(result.annotations.map((item) => item.fileIndex)).size !== result.annotations.length
    )
      return undefined;
    return result;
  } catch {
    return undefined;
  }
}
