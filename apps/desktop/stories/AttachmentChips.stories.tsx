/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { ChipsOption } from "./attachments/compact/ChipsOption.tsx";

const meta = {
  title: "Transcript/Attachment options/Chips",
  component: ChipsOption,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChipsOption>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "620px", "max-width": "calc(100vw - 32px)" }}>
      <ChipsOption />
    </div>
  ),
};

export const Narrow: Story = {
  render: () => (
    <div style={{ width: "390px", "max-width": "calc(100vw - 32px)" }}>
      <ChipsOption />
    </div>
  ),
};

export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div style={{ width: "620px", "max-width": "calc(100vw - 32px)" }}>
      <ChipsOption />
    </div>
  ),
};

export const Expanded: Story = {
  render: () => (
    <div style={{ width: "620px", "max-width": "calc(100vw - 32px)" }}>
      <ChipsOption expanded />
    </div>
  ),
};

export const Interactions: Story = {
  render: () => (
    <div style={{ width: "620px", "max-width": "calc(100vw - 32px)" }}>
      <ChipsOption />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const review = canvas.getByRole("button", { name: "Code review 2" });
    review.focus();
    await userEvent.keyboard("{Enter}");
    await expect(review).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/Keep the draft when sending fails/)).toBeVisible();
    await userEvent.keyboard(" ");
    await expect(review).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Transcript annotation 1" }));
    await expect(canvas.getByText(/The draft is cleared as soon/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Browser annotation 1" }));
    await expect(canvas.getByText(/localhost:3000\/pricing/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Enlarge annotation-1.png" })).toBeVisible();
    const image = canvas.getByRole("button", { name: "Enlarge composer-reference.png" });
    await userEvent.click(image);
    await expect(
      screen.getByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(image).toHaveFocus();
  },
};
