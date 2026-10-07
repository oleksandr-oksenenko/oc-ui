import type { BrowserAnnotationBatch } from "../src/renderer/opencode/browser-annotation-metadata.ts";
import { previewImageFile } from "./image-fixtures.ts";

export function browserAnnotationBatch(numbers: readonly number[]): BrowserAnnotationBatch {
  return {
    files: numbers.map((number) => previewImageFile(`annotation-${number}.png`)),
    annotations: numbers.map((number, fileIndex) => ({
      number,
      mode: "element",
      body: `Give heading ${number} more room`,
      url: "https://example.com/pricing",
      title: "Pricing page",
      capturedAt: "2026-09-29T10:00:00Z",
      selection: {
        frameUrl: "https://example.com/pricing",
        selector: "main h1",
        tag: "h1",
        text: "A heading on the pricing page",
        role: "heading",
        label: "Pricing",
        topFrame: true,
        bounds: { x: 10, y: 20, width: 300, height: 60 },
      },
      fileIndex,
    })),
  };
}
