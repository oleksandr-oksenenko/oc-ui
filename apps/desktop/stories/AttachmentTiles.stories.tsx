/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { TilesOption } from "./attachments/compact/TilesOption.tsx";

const meta = {
  title: "Transcript/Attachment options/Tiles",
  parameters: { layout: "centered" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const frameStyle = {
  width: "560px",
  "max-width": "calc(100vw - 32px)",
} as const;

export const Default: Story = {
  render: () => (
    <div style={frameStyle}>
      <TilesOption />
    </div>
  ),
};

export const Narrow: Story = {
  render: () => (
    <div style={{ width: "390px", "max-width": "calc(100vw - 32px)" }}>
      <TilesOption />
    </div>
  ),
};

export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div style={frameStyle}>
      <TilesOption />
    </div>
  ),
};

export const Interactions: Story = {
  ...Default,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const review = canvas.getByRole("button", { name: "Composer.tsx Review comment" });
    review.focus();
    await userEvent.keyboard("{Enter}");
    await expect(review).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/Keep the draft when sending fails/)).toBeVisible();
    await userEvent.keyboard(" ");
    await expect(review).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      canvas.getByRole("button", { name: "Earlier response Transcript comment" }),
    );
    await expect(canvas.getByText(/Can we clear it only after/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Pricing Browser comment" }));
    await expect(canvas.getByText(/Give this button more breathing room/)).toBeVisible();
    const image = canvas.getByRole("button", { name: "Enlarge composer-reference.png" });
    await userEvent.click(image);
    await expect(
      screen.getByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(image).toHaveFocus();
  },
};
