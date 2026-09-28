/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */

import { expect, fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BuiltInStartup } from "../src/renderer/components/App/BuiltInStartup";

const meta = {
  title: "App/BuiltInStartup",
  component: BuiltInStartup,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: { restart: false, onRetry: fn() },
} satisfies Meta<typeof BuiltInStartup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Starting OpenCode…");
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("radiogroup")).not.toBeInTheDocument();
    const page = canvas.getByRole("main").getBoundingClientRect();
    const status = canvas.getByRole("status").getBoundingClientRect();
    const spinner = canvas.getByRole("status").querySelector("svg")!.getBoundingClientRect();
    const centerX = page.left + page.width / 2;
    await expect(Math.abs(status.left + status.width / 2 - centerX)).toBeLessThan(1);
    await expect(Math.abs(spinner.left + spinner.width / 2 - centerX)).toBeLessThan(1);
    await expect(
      Math.abs(status.top + status.height / 2 - (page.top + page.height / 2)),
    ).toBeLessThan(1);
  },
};

export const Failed: Story = {
  args: { error: "The built-in OpenCode server did not start before the startup timeout." },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(args.error!);
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Retry" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const Stopped: Story = {
  args: { restart: true, error: "The built-in OpenCode server stopped. Restart it to continue." },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Restart" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
