/* oxlint-disable effecttsgo/async-function */

import type { PermissionReply, PermissionRequest } from "@opencode/client";
import { For, createSignal, type JSX } from "solid-js";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { PermissionRequestCard } from "../src/renderer/ui/PermissionRequestCard.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";

const request = {
  id: "per_release_files",
  sessionID: "ses_oc_ui",
  action: "read files",
  resources: [
    "/workspace/apps/desktop/src/renderer/ui/PermissionRequestCard.tsx",
    "/workspace/apps/desktop/src/renderer/ui/PermissionRequestCard.css",
  ],
  save: ["apps/desktop/src/renderer/ui/**", "apps/desktop/stories/**"],
  message: "The agent needs to inspect these files before it can continue.",
  source: { type: "tool", messageID: "msg_release", id: "tool_read_01" },
} satisfies PermissionRequest;

const onReply = fn<(reply: PermissionReply) => void>();

const frameStyle: JSX.CSSProperties = {
  display: "grid",
  height: "100vh",
  "box-sizing": "border-box",
  "align-items": "start",
  "justify-items": "center",
  overflow: "auto",
  padding: "32px",
  background: "var(--oc-surface-subtle)",
};

const narrowFrameStyle: JSX.CSSProperties = {
  ...frameStyle,
  width: "390px",
  height: "760px",
  padding: "12px",
};

const meta = {
  title: "Conversation/PermissionRequestCard",
  component: PermissionRequestCard,
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <main style={frameStyle}>
      <PermissionRequestCard {...args} />
    </main>
  ),
  args: {
    request,
    disabled: false,
    submitting: false,
    error: undefined,
    onReply,
  },
} satisfies Meta<typeof PermissionRequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultRequest: Story = {};

export const ReplyActions: Story = {
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Each control returns its exact upstream reply", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Reject all" }));
      await userEvent.click(canvas.getByRole("button", { name: "Allow once" }));
      await userEvent.click(canvas.getByRole("button", { name: "Always allow" }));
      await expect(args.onReply).toHaveBeenNthCalledWith(1, "reject");
      await expect(args.onReply).toHaveBeenNthCalledWith(2, "once");
      await expect(args.onReply).toHaveBeenNthCalledWith(3, "always");
    });
  },
};

export const MissingSavePatterns: Story = {
  args: { request: { ...request, save: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Always allow" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Allow once" })).toBeVisible();
  },
};

export const Disconnected: Story = {
  args: { disabled: true },
};

export const Submitting: Story = {
  args: { submitting: true },
};

export const ReplyFailure: Story = {
  args: { error: "The permission response could not be sent. Try again." },
};

export const KeyboardAndEscape: Story = {
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Scrollable details and every reply are reachable", async () => {
      await userEvent.tab();
      await expect(canvas.getByRole("list", { name: "Requested resources" })).toHaveFocus();
      await userEvent.tab();
      await expect(canvas.getByRole("list", { name: "Always allow patterns" })).toHaveFocus();
      await userEvent.tab();
      await expect(canvas.getByRole("button", { name: "Reject all" })).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await expect(args.onReply).toHaveBeenLastCalledWith("reject");
    });
    await step("Escape does not reply", async () => {
      const calls = args.onReply.mock.calls.length;
      await userEvent.keyboard("{Escape}");
      await expect(args.onReply).toHaveBeenCalledTimes(calls);
    });
  },
};

export const NarrowLongContent: Story = {
  args: {
    request: {
      ...request,
      action:
        "run a narrowly scoped verification command whose descriptive action is intentionally very long",
      message:
        "Long permission explanations remain readable without clipping. This request demonstrates wrapping, scrolling lists, and stacked actions at the supported narrow viewport.",
      resources: Array.from(
        { length: 12 },
        (_, index) =>
          `/workspace/a-very-long-project-directory/apps/desktop/src/generated/permission-resource-${index + 1}.typescript.tsx`,
      ),
      save: Array.from(
        { length: 10 },
        (_, index) => `apps/desktop/src/renderer/permission-scope-${index + 1}/**/*`,
      ),
      source: {
        type: "tool",
        messageID: "msg_long",
        id: "tool_call_with_an_intentionally_long_identifier_for_wrapping_0123456789",
      },
    },
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: (args) => (
    <main style={narrowFrameStyle}>
      <PermissionRequestCard {...args} />
    </main>
  ),
};

export const CardWidthLayouts: Story = {
  args: NarrowLongContent.args,
  globals: { viewport: { value: "desktop", isRotated: false } },
  render: (args) => (
    <main style={{ ...frameStyle, "grid-template-columns": "360px 620px", gap: "32px" }}>
      <For each={[360, 620]}>
        {(width) => (
          <section aria-label={`${width}px permission slot`} style={{ width: `${width}px` }}>
            <PermissionRequestCard {...args} />
          </section>
        )}
      </For>
    </main>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const width of [360, 620]) {
      const slot = canvas.getByRole("region", { name: `${width}px permission slot` });
      const card = slot.querySelector<HTMLElement>(".permission-request-card")!;
      await expect(card.getBoundingClientRect().width).toBeCloseTo(width, 0);
      await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      const source = card.querySelector<HTMLElement>(".permission-request-source")!;
      const label = source.querySelector("span")!.getBoundingClientRect();
      const code = source.querySelector("code")!.getBoundingClientRect();
      const buttons = [...card.querySelectorAll<HTMLButtonElement>("button")];
      if (width === 360) {
        await expect(code.top).toBeGreaterThanOrEqual(label.bottom);
        for (let index = 1; index < buttons.length; index++) {
          await expect(buttons[index]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
            buttons[index - 1]!.getBoundingClientRect().bottom,
          );
        }
      } else {
        await expect(code.left).toBeGreaterThanOrEqual(label.right);
        for (let index = 1; index < buttons.length; index++) {
          await expect(buttons[index]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
            buttons[index - 1]!.getBoundingClientRect().right,
          );
        }
      }
    }
  },
};

export const NestedListsKeepTranscriptFollowing: Story = {
  args: NarrowLongContent.args,
  globals: { viewport: { value: "desktop", isRotated: false } },
  render: (args) => {
    const [height, setHeight] = createSignal(1000);
    return (
      <main style={{ ...frameStyle, height: "900px", "grid-template-rows": "auto minmax(0, 1fr)" }}>
        <button type="button" onClick={() => setHeight((current) => current + 200)}>
          Grow transcript fixture
        </button>
        <div
          style={{
            display: "grid",
            "grid-template-rows": "minmax(0, 1fr)",
            width: "620px",
            height: "100%",
            "min-height": "0",
          }}
        >
          <TranscriptView
            sessionID="ses_oc_ui"
            messages={[]}
            sessionStatus="running"
            pendingInteraction={
              <div class="permission-request-entry">
                <div style={{ height: `${height()}px` }} aria-hidden="true" />
                <PermissionRequestCard {...args} />
              </div>
            }
          />
        </div>
      </main>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    const expectFollowing = () =>
      expect(
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      ).toBeLessThanOrEqual(2);
    await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    await waitFor(expectFollowing);
    for (const name of ["Requested resources", "Always allow patterns"]) {
      const list = canvas.getByRole("list", { name });
      await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      // Synthetic input verifies the follow policy, not native scrolling or chaining.
      for (const event of [
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        new WheelEvent("wheel", { deltaY: -120, bubbles: true }),
      ]) {
        list.focus({ preventScroll: true });
        list.querySelector("code")!.dispatchEvent(event);
        const before = viewport.scrollHeight;
        await userEvent.click(canvas.getByRole("button", { name: "Grow transcript fixture" }));
        await waitFor(() => expect(viewport.scrollHeight).toBeGreaterThan(before));
        await waitFor(expectFollowing);
      }
    }
  },
};
