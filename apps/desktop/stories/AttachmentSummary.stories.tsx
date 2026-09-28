/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { SummaryOption } from "./attachments/compact/SummaryOption.tsx";
import { annotations, browserAnnotation, reviewComments } from "./attachment-fixtures.ts";

const meta = {
  title: "Transcript/Attachment options/Summary",
  component: SummaryOption,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SummaryOption>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow390: Story = {
  render: () => (
    <div style={{ width: "390px", "max-width": "100%" }}>
      <SummaryOption />
    </div>
  ),
};

export const Dark: Story = { globals: { theme: "dark" } };

export const Interactions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "4 files · 4 comments" });
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(reviewComments[0]!.body)).toBeVisible();
    await expect(canvas.getByText(annotations[0]!.quote)).toBeVisible();
    await expect(canvas.getByText(browserAnnotation.tab.url)).toBeVisible();
    await expect(canvas.getByText("requirements.pdf")).toBeVisible();

    const image = canvas.getByRole("button", { name: "Enlarge composer-reference.png" });
    await userEvent.click(image);
    await expect(
      screen.getByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(image).toHaveFocus();

    toggle.focus();
    await userEvent.keyboard(" ");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  },
};
