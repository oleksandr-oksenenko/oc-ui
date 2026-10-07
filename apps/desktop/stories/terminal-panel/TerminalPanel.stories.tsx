/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { TerminalPanelFixture } from "./TerminalPanelFixture.tsx";

const connectedTabs = [
  { id: "1", title: "Terminal 1", status: "connected" },
  { id: "2", title: "Terminal 2", status: "connected" },
];

const meta = {
  title: "Terminal/TerminalPanel",
  component: TerminalPanelFixture,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TerminalPanelFixture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No terminals open")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "New terminal" }));
    await expect(canvas.getByRole("tab", { name: "Terminal 3" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

export const ProjectRequired: Story = { args: { canCreate: false } };
export const Creating: Story = { args: { creating: true } };
export const Connecting: Story = {
  args: {
    tabs: [
      { id: "1", title: "Terminal 1", status: "connecting" },
      { id: "2", title: "Terminal 2", status: "reconnecting" },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAccessibleDescription(
      "connecting",
    );
    await expect(canvas.getByRole("tab", { name: "Terminal 2" })).toHaveAccessibleDescription(
      "reconnecting",
    );
  },
};

export const Connected: Story = {
  args: { tabs: connectedTabs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Terminal 1 input" });
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
    await expect(canvas.queryByText("connected")).not.toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).not.toHaveAttribute(
      "aria-describedby",
    );
    await userEvent.type(input, "pnpm test");
    await userEvent.click(canvas.getByRole("tab", { name: "Terminal 2" }));
    await expect(canvas.getByRole("textbox", { name: "Terminal 2 input" })).toBeVisible();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(canvas.getByRole("textbox", { name: "Terminal 1 input" })).toBe(input);
    await expect(input).toHaveValue("pnpm test");
    await userEvent.click(canvas.getByRole("button", { name: "Close terminal Terminal 2" }));
    await expect(canvas.queryByRole("tab", { name: "Terminal 2" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: /^Hide terminal$/ }));
    await expect(input).toBeInTheDocument();
    await expect(input).not.toBeVisible();
    await expect(canvas.getByRole("button", { name: "Show terminal" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("textbox", { name: "Terminal 1 input" })).toBe(input);
    await expect(input).toHaveValue("pnpm test");
  },
};

export const Failed: Story = {
  args: {
    tabs: [
      {
        id: "1",
        title: "Terminal 1",
        status: "failed",
        error: "Terminal connection was interrupted.",
      },
      { id: "2", title: "Terminal 2", status: "connected" },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAccessibleDescription(
      "failed",
    );
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Terminal connection was interrupted.",
    );
    await userEvent.click(canvas.getByRole("tab", { name: "Terminal 2" }));
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAccessibleDescription(
      "failed",
    );
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: "Terminal 1" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reconnect terminal" }));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
    await expect(canvas.queryByText("connected")).not.toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).not.toHaveAttribute(
      "aria-describedby",
    );
  },
};

export const Exited: Story = {
  args: { tabs: [{ id: "1", title: "Terminal 1", status: "exited" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Terminal 1" })).toHaveAccessibleDescription(
      "exited",
    );
    await expect(
      canvas.queryByRole("button", { name: "Reconnect terminal" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("status")).toHaveTextContent("Open a new terminal");
  },
};

export const CreateFailed: Story = { args: { error: "The server could not create a terminal." } };

export const Resizable: Story = {
  args: { tabs: connectedTabs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvas.getByRole("separator", { name: "Resize terminal panel" });
    const bottom = canvasElement.querySelector<HTMLElement>(".shell-bottom-panel")!;
    const main = canvasElement.querySelector<HTMLElement>(".shell-main")!;
    const sidebar = canvasElement.querySelector<HTMLElement>(".shell-left-sidebar")!;
    const initialHeight = bottom.getBoundingClientRect().height;
    await userEvent.click(handle);
    await userEvent.keyboard("{ArrowUp}");
    await expect(bottom.getBoundingClientRect().height).toBeGreaterThan(initialHeight);
    await userEvent.keyboard("{End}");
    await expect(main.getBoundingClientRect().height).toBeGreaterThanOrEqual(159);
    await expect(sidebar.getBoundingClientRect().height).toBeGreaterThan(
      bottom.getBoundingClientRect().height,
    );
    await expect(bottom.getBoundingClientRect().left).toBe(sidebar.getBoundingClientRect().right);
    await userEvent.keyboard("{Home}");
    await expect(bottom.getBoundingClientRect().height).toBe(120);
    const y = handle.getBoundingClientRect().y;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientY: y }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: y - 80 }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientY: y - 80 }),
    );
    await expect(bottom.getBoundingClientRect().height).toBe(200);
  },
};

export const Narrow: Story = {
  args: { tabs: connectedTabs },
  globals: { viewport: { value: "narrow", isRotated: false } },
};

export const Mobile: Story = {
  args: { tabs: connectedTabs },
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bottom = canvasElement.querySelector<HTMLElement>(".shell-bottom-panel")!;
    await expect(bottom.getBoundingClientRect().width).toBe(
      canvasElement.getBoundingClientRect().width,
    );
    await userEvent.click(canvas.getByRole("button", { name: "Show sessions" }));
    await expect(bottom.inert).toBe(true);
    await expect(
      canvas.queryByRole("separator", { name: "Resize terminal panel" }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Hide session list" }));
    await expect(bottom.inert).toBe(false);
    await expect(canvas.getByRole("textbox", { name: "Terminal 1 input" })).toBeVisible();
  },
};
