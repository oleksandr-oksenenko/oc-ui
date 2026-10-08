/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { Browser } from "@opencode/plugin-browser/rpc";
import { BrowserPane } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";
import { BrowserAnnotations } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import { UserMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx";
import { browserAnnotationMetadata } from "../src/renderer/opencode/browser-annotation-metadata.ts";
import { browserAnnotation, browserMessage } from "./attachment-fixtures.ts";

const tabs = Array.from({ length: 12 }, (_, index) => ({
  ...browserAnnotation.tab,
  id: Browser.TabID.make(`tab_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
  title: `Preview ${index + 1}`,
}));
const comments = Array.from({ length: 5 }, (_, index) => ({
  ...browserAnnotation,
  id: `annotation-${index + 1}`,
  number: index + 1,
  body: Array.from(
    { length: 12 },
    (_line, line) => `Change ${line + 1}: keep the pricing controls aligned with the heading.`,
  ).join("\n"),
}));
const controller = {
  annotations: () => ({ status: "idle" as const, items: comments }),
  annotate: fn(),
  cancelAnnotation: fn(),
  annotationBody: fn(),
  discardAnnotation: fn(),
  clearAnnotations: fn(),
  addAnnotations: fn(),
};
const state = {
  status: "connected" as const,
  bindingID: "fixture",
  browser: { tabs, focusedTabID: tabs[0]!.id },
  error: Array.from(
    { length: 16 },
    () => "The preview could not load a resource from the development server.",
  ).join(" "),
};

const meta = {
  title: "Context/BrowserScrollbars",
  component: BrowserPane,
  render: (args) => (
    <BrowserPane
      {...args}
      annotation={<BrowserAnnotations controller={controller} state={args.state} />}
    />
  ),
  decorators: [
    (Story) => (
      <div style={{ width: "min(360px, 100vw)", height: "600px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessionSelected: true,
    state,
    onReconnect: fn(),
    onCommand: fn(),
  },
} satisfies Meta<typeof BrowserPane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Chrome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tabList = canvasElement.querySelector<HTMLElement>(".browser-tab-list")!;
    const annotations = canvas.getByRole("list");
    const editor = canvas.getByRole("textbox", { name: "Annotation 1 comment" });
    const error = canvas.getByRole("alert");
    await expect(tabList.scrollWidth).toBeGreaterThan(tabList.clientWidth);
    for (const region of [annotations, editor, error]) {
      await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
      region.scrollTop = 30;
      await expect(region.scrollTop).toBeGreaterThan(0);
      region.scrollTop = 0;
    }
    for (const region of [tabList, annotations, editor, error]) {
      await expect(getComputedStyle(region).scrollbarWidth).toBe("thin");
      await expect(getComputedStyle(region).scrollbarColor).not.toBe("auto");
    }
    tabList.scrollLeft = tabList.scrollWidth;
    await expect(tabList.scrollLeft).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Preview 12" }));
    await expect(meta.args.onCommand).toHaveBeenCalledWith({
      type: "tabs.focus",
      tabID: state.browser.tabs[11]!.id,
    });
  },
};

export const ChromeDark: Story = { ...Chrome, globals: { theme: "dark" } };

export const EmptyOverflow: Story = {
  args: { state: { status: "unsupported", browser: { tabs: [], focusedTabID: null } } },
  decorators: [
    (Story) => (
      <div style={{ width: "180px", height: "100px" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const region = canvasElement.querySelector<HTMLElement>(".browser-empty")!;
    await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    await expect(getComputedStyle(region).scrollbarWidth).toBe("thin");
    region.scrollTop = region.scrollHeight;
    await expect(region.scrollTop).toBeGreaterThan(0);
  },
};

export const Details: Story = {
  render: () => (
    <UserMessage
      message={{
        ...browserMessage,
        metadata: browserAnnotationMetadata("", [
          {
            number: browserAnnotation.number,
            mode: browserAnnotation.mode,
            capturedAt: browserAnnotation.capturedAt,
            selection: browserAnnotation.selection,
            body: comments[0]!.body.repeat(4),
            url: browserAnnotation.tab.url,
            title: browserAnnotation.tab.title,
            fileIndex: 0,
          },
        ]),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Browser · 1" });
    await userEvent.click(trigger);
    const popup = await screen.findByRole("dialog", { name: "Browser annotations" });
    await expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
    await expect(getComputedStyle(popup).scrollbarWidth).toBe("thin");
    await expect(getComputedStyle(popup).scrollbarColor).not.toBe("auto");
    popup.scrollTop = popup.scrollHeight;
    await expect(popup.scrollTop).toBeGreaterThan(0);
    await expect(
      within(popup).getByRole("button", { name: "Enlarge Browser annotation 1" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
  },
};

export const DetailsDark: Story = { ...Details, globals: { theme: "dark" } };
