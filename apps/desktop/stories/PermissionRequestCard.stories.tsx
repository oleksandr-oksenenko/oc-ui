/* oxlint-disable effecttsgo/async-function */

import type { PermissionReply, PermissionRequest } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import { type JSX } from "solid-js";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { PermissionRequestCard } from "../src/renderer/ui/PermissionRequestCard.tsx";

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
  background: "#050506",
};

const narrowFrameStyle: JSX.CSSProperties = {
  ...frameStyle,
  width: "390px",
  height: "760px",
  padding: "12px",
};

const stateStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  color: "var(--oc-text-base)",
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

export const Loading: Story = {
  render: () => (
    <main style={frameStyle}>
      <output style={stateStyle} aria-live="polite">
        <Loader width={18} height={18} aria-hidden="true" /> Loading permissions
      </output>
    </main>
  ),
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

export const RefreshFailureWithoutRequest: Story = {
  render: () => (
    <main style={frameStyle}>
      <div style={{ ...stateStyle, "flex-direction": "column" }} role="alert">
        <p>Permissions could not be refreshed. Try again.</p>
        <Button type="button" size="small" variant="outline">
          Retry permissions
        </Button>
      </div>
    </main>
  ),
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
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: (args) => (
    <main style={narrowFrameStyle}>
      <PermissionRequestCard {...args} />
    </main>
  ),
};
