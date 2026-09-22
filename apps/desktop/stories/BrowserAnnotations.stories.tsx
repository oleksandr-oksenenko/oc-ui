/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Browser } from "@opencode/plugin-browser/rpc";
import {
  BrowserAnnotations,
  type BrowserAnnotationsController,
} from "../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import type { BrowserAnnotationDraft } from "../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";

const tab = {
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

const draft: BrowserAnnotationDraft = {
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

const controller: BrowserAnnotationsController = {
  annotations: () => ({ status: "idle", items: [draft] }),
  annotate: fn(),
  cancelAnnotation: fn(),
  annotationBody: fn(),
  discardAnnotation: fn(),
  clearAnnotations: fn(),
  addAnnotations: fn(),
};

const meta = {
  title: "Context/BrowserAnnotations",
  component: BrowserAnnotations,
  decorators: [
    (Story) => (
      <div
        style={{
          width: "min(520px, 100vw)",
          padding: "8px",
          background: "var(--oc-surface-canvas)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    controller,
    state: {
      status: "connected",
      bindingID: "fixture",
      browser: { tabs: [tab], focusedTabID: tab.id },
    },
  },
} satisfies Meta<typeof BrowserAnnotations>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Captured: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const comment = canvasElement.querySelector<HTMLTextAreaElement>(
      '[aria-label="Annotation 1 comment"]',
    );
    if (!comment) throw new Error("Annotation comment editor missing");
    await expect(comment.value).toBe("Make this button wider");
    await userEvent.type(comment, " and taller");
    await expect(controller.annotationBody).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Add to composer" }));
    await expect(controller.addAnnotations).toHaveBeenCalledOnce();
  },
};

export const Picking: Story = {
  args: {
    controller: {
      ...controller,
      annotations: () => ({ status: "picking", items: [], request: "request-2" }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Cancel selection" }));
    await expect(controller.cancelAnnotation).toHaveBeenCalled();
  },
};
