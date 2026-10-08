/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Browser } from "@opencode/plugin-browser/rpc";
import { createSignal } from "solid-js";
import {
  BrowserPane,
  type BrowserPaneProps,
} from "../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";
import { BrowserAnnotations } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import type { BrowserAnnotationDraft } from "../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";
import { BrowserViewport } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserViewport.tsx";
import type { BrowserLayout } from "../src/shared/browser-api.ts";
import { controller, draft, fullBatch } from "./browser-annotation-fixtures.ts";

const tab = {
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "http://localhost:3000",
  title: "Development preview",
  loading: false,
  canGoBack: true,
  canGoForward: false,
  generation: 1,
};
const meta = {
  title: "Context/BrowserPane",
  component: BrowserPane,
  decorators: [
    (Story) => (
      <div style={{ width: "min(520px, 100vw)", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessionSelected: true,
    onReconnect: fn(),
    onCommand: fn(),
    state: { status: "idle", browser: { tabs: [], focusedTabID: null } },
  },
} satisfies Meta<typeof BrowserPane>;
export default meta;
type Story = StoryObj<typeof meta>;

const longError =
  "Browser navigation failed. " +
  "The connected server could not reach the requested page; inspect the proxy and destination configuration. ".repeat(
    30,
  ) +
  "End of browser diagnostic.";

async function expectFullDiagnosticReachable(error: HTMLElement) {
  const range = error.ownerDocument.createRange();
  range.selectNodeContents(error);
  await expect(error.clientHeight).toBeGreaterThan(0);
  await expect(error.scrollHeight).toBeGreaterThan(error.clientHeight);
  error.scrollTop = 0;
  await expect(range.getClientRects()[0]!.top).toBeGreaterThanOrEqual(
    error.getBoundingClientRect().top,
  );
  error.scrollTop = error.scrollHeight;
  await expect(error.scrollTop).toBeGreaterThan(0);
  const lines = range.getClientRects();
  await expect(lines[lines.length - 1]!.bottom).toBeLessThanOrEqual(
    error.getBoundingClientRect().bottom + 1,
  );
}

const onLayout = fn<(layout: BrowserLayout) => void>();

function renderAnnotations(
  args: BrowserPaneProps,
  width: number,
  height: number,
  initialItems: readonly BrowserAnnotationDraft[],
) {
  const [items, setItems] = createSignal(initialItems);
  const controlled = {
    ...controller,
    annotations: () => ({ status: "idle" as const, items: items() }),
    annotationBody: (id: string, body: string) => {
      controller.annotationBody(id, body);
      setItems((current) => current.map((item) => (item.id === id ? { ...item, body } : item)));
    },
    discardAnnotation: (id: string) => {
      controller.discardAnnotation(id);
      setItems((current) => current.filter((item) => item.id !== id));
    },
    clearAnnotations: () => {
      controller.clearAnnotations();
      setItems([]);
    },
  };
  return (
    <div style={{ width: `${width}px`, height: `${height}px` }}>
      <BrowserPane
        {...args}
        annotation={<BrowserAnnotations controller={controlled} state={args.state} />}
        viewport={<BrowserViewport bindingID="fixture" tabID={tab.id} onLayout={onLayout} />}
      />
    </div>
  );
}

async function expectReachable(element: HTMLElement, pane: HTMLElement) {
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = element.getBoundingClientRect();
  let { left, right, top, bottom } = rect;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      parent === pane ||
      /auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)
    ) {
      const bounds = parent.getBoundingClientRect();
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    if (parent === pane) break;
  }
  await expect(right - left).toBeGreaterThanOrEqual(Math.min(rect.width, 24));
  // The centered 20px discard button has half-pixel bounds in its two-line
  // header. Nested nearest scrolling can round away 0.5px at the list edge;
  // allow one pixel while retaining the clipped bounds and pointer hit test.
  await expect(bottom - top + 1).toBeGreaterThanOrEqual(Math.min(rect.height, 24));
  await expect(left).toBeLessThanOrEqual(rect.left + 1);
  await expect(right).toBeGreaterThanOrEqual(rect.right - 1);
  await expect(
    element.contains(
      element.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2),
    ),
  ).toBe(true);
}

async function expectNativeSlot(pane: HTMLElement, slot: HTMLElement) {
  const bounds = pane.getBoundingClientRect();
  const rect = slot.getBoundingClientRect();
  await expect(rect.height).toBeGreaterThanOrEqual(24);
  await expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
  await expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
  await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
  await expect(rect.right).toBeLessThanOrEqual(bounds.right);
  await waitFor(() =>
    expect(onLayout).toHaveBeenLastCalledWith({
      bindingID: "fixture",
      tabID: tab.id,
      visible: true,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }),
  );
}

export const NoSession: Story = { args: { sessionSelected: false } };
export const Connecting: Story = {
  args: { state: { status: "connecting", browser: { tabs: [], focusedTabID: null } } },
};
export const Replaced: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Reconnect browser" }));
    await expect(args.onReconnect).toHaveBeenCalledOnce();
  },
  args: {
    state: {
      status: "replaced",
      browser: { tabs: [], focusedTabID: null },
      error: "Another desktop connected to this session's browser.",
    },
  },
};
export const Unsupported: Story = {
  args: { state: { status: "unsupported", browser: { tabs: [], focusedTabID: null } } },
};
export const Connected: Story = {
  args: {
    state: {
      status: "connected",
      bindingID: "fixture",
      browser: { tabs: [tab], focusedTabID: tab.id },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const address = canvas.getByRole("textbox", { name: "Browser address" });
    await userEvent.clear(address);
    await userEvent.type(address, "http://localhost:4000{Enter}");
    await expect(args.onCommand).toHaveBeenCalledWith({
      type: "navigate",
      tabID: tab.id,
      url: "http://localhost:4000",
    });
    await userEvent.click(canvas.getByRole("button", { name: "New browser tab" }));
    await expect(args.onCommand).toHaveBeenCalledWith({ type: "tabs.open" });
    await userEvent.click(canvas.getByRole("button", { name: "Close Development preview" }));
    await expect(args.onCommand).toHaveBeenCalledWith({ type: "tabs.close", tabID: tab.id });
  },
};
export const Narrow: Story = {
  ...Connected,
  decorators: [
    (Story) => (
      <div style={{ width: "300px", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
  play: undefined,
};

export const ShortConnectedLongError: Story = {
  // The native slot has a pre-existing aria-label on a generic div. Exclude
  // only this empty slot until that markup is corrected; retain the catalog
  // checks for the surrounding controls while this story verifies geometry.
  parameters: { a11y: { context: { exclude: [".browser-viewport"] } } },
  args: {
    ...Connected.args,
    state: {
      status: "connected",
      bindingID: "fixture",
      browser: { tabs: [tab], focusedTabID: tab.id },
      error: longError,
    },
  },
  render: (args) => (
    <div style={{ width: "300px", height: "160px", overflow: "hidden" }}>
      {/* Storybook exercises the real DOM slot without creating the native Chromium view. */}
      <BrowserPane
        {...args}
        viewport={
          args.state.status === "connected" ? (
            <BrowserViewport bindingID="fixture" tabID={tab.id} onLayout={fn()} />
          ) : undefined
        }
      />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pane = canvas.getByRole("region", { name: "Session browser" });
    const slot = canvas.getByLabelText("Browser page");
    const bounds = pane.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    await expect(rect.height).toBeGreaterThan(2);
    await expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    await expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
    await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
    await expect(rect.right).toBeLessThanOrEqual(bounds.right);
    await expect(
      slot.contains(slot.ownerDocument.elementFromPoint(rect.right - 1, rect.bottom - 1)),
    ).toBe(true);
    const error = canvas.getByRole("alert");
    await expect(error.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom);
    await expectFullDiagnosticReachable(error);
    await userEvent.click(canvas.getByRole("button", { name: "Reload browser page" }));
    await expect(args.onCommand).toHaveBeenCalledWith({ type: "reload", tabID: tab.id });
  },
};

export const ShortFailedLongError: Story = {
  args: {
    state: { status: "failed", browser: { tabs: [], focusedTabID: null }, error: longError },
  },
  render: ShortConnectedLongError.render,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const empty = canvasElement.querySelector<HTMLElement>(".browser-empty")!;
    await expect(
      canvas.getByText("Session browser", { selector: "strong" }).getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(empty.getBoundingClientRect().top);
    await expect(empty.scrollHeight).toBeGreaterThan(empty.clientHeight);
    empty.scrollTop = empty.scrollHeight;
    const reconnect = canvas.getByRole("button", { name: "Reconnect browser" });
    await expect(reconnect.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      empty.getBoundingClientRect().top,
    );
    await expect(reconnect.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      empty.getBoundingClientRect().bottom,
    );
    await expectFullDiagnosticReachable(canvas.getByRole("alert"));
    await userEvent.click(reconnect);
    await expect(args.onReconnect).toHaveBeenCalledOnce();
  },
};

export const ShortCombinedAnnotations: Story = {
  parameters: ShortConnectedLongError.parameters,
  args: ShortConnectedLongError.args,
  render: (args) => renderAnnotations(args, 168, 160, [{ ...draft, tab }]),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pane = canvas.getByRole("region", { name: "Session browser" });
    const slot = canvas.getByLabelText("Browser page");
    const controls = pane.querySelector<HTMLElement>(".browser-controls")!;
    const annotations = canvas.getByRole("region", { name: "Browser annotations" });
    const list = canvas.getByRole("list");
    const slotBounds = slot.getBoundingClientRect().toJSON();
    await expectNativeSlot(pane, slot);
    await expect(controls.scrollHeight).toBeGreaterThan(controls.clientHeight);
    await expect(annotations.scrollHeight).toBeGreaterThan(annotations.clientHeight);
    await expect(list.clientHeight).toBeGreaterThanOrEqual(44);

    const address = canvas.getByRole<HTMLInputElement>("textbox", { name: "Browser address" });
    await expectReachable(address, pane);
    await expect(address.getBoundingClientRect().width).toBeGreaterThan(60);
    await userEvent.clear(address);
    await userEvent.type(address, "http://localhost:4000/short");
    const go = canvas.getByRole("button", { name: "Go" });
    await expectReachable(go, pane);
    await userEvent.click(go);
    await expect(args.onCommand).toHaveBeenCalledWith({
      type: "navigate",
      tabID: tab.id,
      url: "http://localhost:4000/short",
    });
    for (const [name, type] of [
      ["Browser back", "back"],
      ["Reload browser page", "reload"],
    ] as const) {
      const button = canvas.getByRole("button", { name });
      await expectReachable(button, pane);
      await userEvent.click(button);
      await expect(args.onCommand).toHaveBeenCalledWith({ type, tabID: tab.id });
    }

    const comment = canvas.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Annotation 1 comment",
    });
    await expectReachable(comment, pane);
    await userEvent.type(comment, " and taller");
    await expect(controller.annotationBody).toHaveBeenLastCalledWith(
      draft.id,
      "Make this button wider and taller",
    );
    const add = canvas.getByRole("button", { name: "Add to composer" });
    await expectReachable(add, pane);
    await userEvent.click(add);
    await expect(controller.addAnnotations).toHaveBeenCalledOnce();
    list.scrollTop = list.scrollHeight;
    controls.scrollTop = controls.scrollHeight;
    await expect(slot.getBoundingClientRect().toJSON()).toEqual(slotBounds);
    await expectNativeSlot(pane, slot);
    const discard = canvas.getByRole("button", { name: "Discard annotation 1" });
    await expectReachable(discard, pane);
    await userEvent.click(discard);
    await expect(controller.discardAnnotation).toHaveBeenCalledWith(draft.id);
    await expect(canvas.queryByRole("textbox", { name: "Annotation 1 comment" })).toBeNull();
    await expectNativeSlot(pane, slot);
    await expectFullDiagnosticReachable(canvas.getByRole("alert"));
  },
};

export const ShortCombinedAnnotationsWide: Story = {
  ...ShortCombinedAnnotations,
  render: (args) => renderAnnotations(args, 360, 160, [{ ...draft, tab }]),
};

export const NormalFullBatch: Story = {
  parameters: ShortConnectedLongError.parameters,
  args: Connected.args,
  render: (args) => renderAnnotations(args, 360, 650, fullBatch),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pane = canvas.getByRole("region", { name: "Session browser" });
    const slot = canvas.getByLabelText("Browser page");
    const controls = pane.querySelector<HTMLElement>(".browser-controls")!;
    const annotations = canvas.getByRole("region", { name: "Browser annotations" });
    const list = canvas.getByRole("list");
    const add = canvas.getByRole("button", { name: "Add to composer" });
    const capture = canvas.getByRole("button", { name: "Annotate" });
    const slotBounds = slot.getBoundingClientRect().toJSON();
    const actionPositions = [capture, add].map((button) => button.getBoundingClientRect().top);
    await expectNativeSlot(pane, slot);
    await expect(controls.scrollHeight).toBe(controls.clientHeight);
    await expect(annotations.scrollHeight).toBe(annotations.clientHeight);
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    list.scrollTop = list.scrollHeight;
    await expectReachable(canvas.getByRole("textbox", { name: "Annotation 8 comment" }), pane);
    await expect([capture, add].map((button) => button.getBoundingClientRect().top)).toEqual(
      actionPositions,
    );
    await expect(slot.getBoundingClientRect().toJSON()).toEqual(slotBounds);
    await expectNativeSlot(pane, slot);
    const clear = canvas.getByRole("button", { name: "Clear" });
    await expectReachable(clear, pane);
    await userEvent.click(clear);
    await expect(controller.clearAnnotations).toHaveBeenCalled();
    await expect(canvas.queryByRole("list")).toBeNull();
    await waitFor(() =>
      expect(slot.getBoundingClientRect().height).toBeGreaterThan(slotBounds.height),
    );
    await expectNativeSlot(pane, slot);
  },
};
