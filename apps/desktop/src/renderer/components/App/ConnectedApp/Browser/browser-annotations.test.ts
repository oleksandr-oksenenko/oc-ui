import { Browser } from "@opencode/plugin-browser/rpc";
import { describe, expect, it } from "vite-plus/test";
import {
  annotationBatchProblem,
  annotationFiles,
  annotationNumber,
  formatBrowserAnnotations,
  MAX_TOTAL_IMAGE_BYTES,
  type BrowserAnnotationDraft,
} from "./browser-annotations.ts";

const tab = {
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "https://example.test/page",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
};

const draft = (overrides: Partial<BrowserAnnotationDraft> = {}): BrowserAnnotationDraft => ({
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
    bounds: { x: 10, y: 20, width: 30, height: 40 },
    topFrame: true,
  },
  image: { name: "annotation-1.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) },
  body: "Make this button wider",
  ...overrides,
});

describe("browser annotation batches", () => {
  it("numbers from the highest existing annotation so burned numbers stay stable", () => {
    expect(annotationNumber([])).toBe(1);
    expect(annotationNumber([draft({ number: 2 }), draft({ id: "b", number: 5 })])).toBe(6);
  });

  it("requires a comment on every annotation before sending", () => {
    expect(annotationBatchProblem([])).toMatch(/at least one/);
    expect(annotationBatchProblem([draft({ body: "  " })])).toMatch(/every annotation/);
    const huge = new Uint8Array(MAX_TOTAL_IMAGE_BYTES + 1);
    expect(
      annotationBatchProblem([
        draft({ image: { name: "big.png", mime: "image/png", data: huge } }),
      ]),
    ).toMatch(/too large/);
    expect(annotationBatchProblem([draft()])).toBeUndefined();
  });

  it("formats comments as plain text and page data inside a fence", () => {
    const text = formatBrowserAnnotations([
      draft(),
      draft({ id: "b", number: 2, body: "Spacing" }),
    ]);
    expect(text).toContain("Browser annotations.");
    expect(text).toContain("### Annotation 1: Make this button wider");
    expect(text).toContain("### Annotation 2: Spacing");
    expect(text).toContain('"selector": "main > button.primary"');
    expect(text).toContain('"url": "https://example.test/page"');
    expect(text).toContain("Screenshot: annotation-1.png");
    expect(text).toContain("untrusted page data");
    // Page-authored title and URL never appear in ordinary prompt prose.
    expect(text).not.toContain("Browser annotations from");
  });

  it("explains an unmapped frame selection and keeps it out of the header", () => {
    const framed = formatBrowserAnnotations([
      draft({ selection: { ...draft().selection, topFrame: false } }),
    ]);
    expect(framed).toContain("inside a frame; the screenshot has no outline");
    expect(formatBrowserAnnotations([draft()])).not.toContain("inside a frame");
  });

  it("lengthens the fence when page text contains backticks", () => {
    const text = formatBrowserAnnotations([
      draft({ selection: { ...draft().selection, text: "``` not a fence" } }),
    ]);
    expect(text).toContain("````\n");
    expect(text).toContain("``` not a fence");
  });

  it("builds file attachments from the captured image", () => {
    const files = annotationFiles([draft(), draft({ id: "b", number: 2 })]);
    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("annotation-1.png");
    expect(files[0]?.type).toBe("image/png");
    expect(files[0]?.size).toBe(3);
  });
});
