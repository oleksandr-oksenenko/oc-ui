import { describe, expect, it } from "vite-plus/test";
import {
  browserAnnotationMetadata,
  readBrowserAnnotationMetadata,
  BROWSER_ANNOTATIONS_METADATA_KEY,
  type SentBrowserAnnotation,
} from "./browser-annotation-metadata.ts";

const annotation: SentBrowserAnnotation = {
  number: 1,
  mode: "element",
  body: "More space",
  url: "https://example.com",
  title: "Example",
  capturedAt: "2026-09-29T10:00:00Z",
  fileIndex: 1,
  selection: {
    frameUrl: "https://example.com",
    selector: "h1",
    tag: "h1",
    text: "Heading",
    role: "heading",
    label: "Heading",
    topFrame: true,
    bounds: { x: 0, y: 0, width: 100, height: 30 },
  },
};

describe("browser annotation metadata", () => {
  it("round-trips captured context and hides only intact generated blocks", () => {
    const metadata = browserAnnotationMetadata(
      "Please fix this.\n\nCaptured context\n\nAlso check contrast.",
      [{ text: "Captured context", annotations: [annotation] }],
    );
    expect(readBrowserAnnotationMetadata(metadata)).toEqual({
      version: 1,
      instruction: "Please fix this.\n\n\n\nAlso check contrast.",
      annotations: [annotation],
    });
    expect(
      browserAnnotationMetadata("Captured EDITED context", [
        { text: "Captured context", annotations: [annotation] },
      ]),
    ).toBeUndefined();
  });
  it("preserves leading instruction offsets used by inline skill mentions", () => {
    const metadata = browserAnnotationMetadata("  review this\n\nCaptured context", [
      { text: "Captured context", annotations: [annotation] },
    ]);
    expect(readBrowserAnnotationMetadata(metadata)?.instruction).toBe("  review this");
  });
  it("rejects unknown versions, negative and duplicate screenshot references", () => {
    const metadata = browserAnnotationMetadata("Captured context", [
      { text: "Captured context", annotations: [annotation] },
    ])!;
    const value = metadata[BROWSER_ANNOTATIONS_METADATA_KEY];
    for (const invalid of [
      { ...value, version: 2 },
      { ...value, annotations: [{ ...annotation, fileIndex: -1 }] },
      { ...value, annotations: [annotation, annotation] },
    ]) {
      expect(
        readBrowserAnnotationMetadata({ [BROWSER_ANNOTATIONS_METADATA_KEY]: invalid }),
      ).toBeUndefined();
    }
    expect(readBrowserAnnotationMetadata(undefined)).toBeUndefined();
  });
});
