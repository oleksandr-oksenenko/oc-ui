import { Browser } from "@opencode/plugin-browser/rpc";
import { fn } from "storybook/test";
import type { BrowserAnnotationsController } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import type { BrowserAnnotationDraft } from "../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";
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

export const tab = {
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "http://localhost:3000/pricing",
  title: "Development preview",
  loading: false,
  canGoBack: true,
  canGoForward: false,
  generation: 1,
};

// A one-pixel PNG is enough for the thumbnail; the real capture carries the composited screenshot.
const redPixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

export const draft: BrowserAnnotationDraft = {
  id: "annotation-1",
  number: 1,
  mode: "element",
  tab,
  capturedAt: "2026-09-19T12:00:00.000Z",
  selection: {
    frameUrl: tab.url,
    selector: "main > button.primary",
    tag: "button",
    text: "Choose Pro",
    role: "",
    label: "Choose Pro",
    bounds: { x: 120, y: 240, width: 160, height: 42 },
    topFrame: true,
  },
  image: { name: "annotation-1.png", mime: "image/png", data: redPixel },
  body: "Make this button wider",
};

export const fullBatch = Array.from({ length: 8 }, (_, index) => ({
  ...draft,
  id: `annotation-${index + 1}`,
  number: index + 1,
  tab: { ...tab, url: `${tab.url}?long-page-provenance=${"path".repeat(40)}` },
}));

export const controller: BrowserAnnotationsController = {
  annotations: () => ({ status: "idle", items: [draft] }),
  annotate: fn(),
  cancelAnnotation: fn(),
  annotationBody: fn(),
  discardAnnotation: fn(),
  clearAnnotations: fn(),
  addAnnotations: fn(),
};
