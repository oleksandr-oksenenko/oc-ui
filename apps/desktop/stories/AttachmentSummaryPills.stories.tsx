/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { SummaryPillsOption } from "./attachments/compact/SummaryPillsOption.tsx";
import { reviewComments } from "./attachment-fixtures.ts";

const meta = {
  title: "Transcript/Attachment options/Summary + pills",
  component: SummaryPillsOption,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SummaryPillsOption>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  render: () => (
    <div class="att-summary-pills-story">
      <SummaryPillsOption />
    </div>
  ),
};

export const Expanded: Story = {
  render: () => (
    <div class="att-summary-pills-story">
      <SummaryPillsOption initiallyExpanded />
    </div>
  ),
};

export const Narrow390: Story = {
  render: () => (
    <div class="att-summary-pills-narrow">
      <SummaryPillsOption initiallyExpanded />
    </div>
  ),
};

export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div class="att-summary-pills-story">
      <SummaryPillsOption initiallyExpanded />
    </div>
  ),
};

export const Interactions: Story = {
  render: () => (
    <div class="att-summary-pills-story">
      <SummaryPillsOption />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByRole("button", { name: "4 files · 4 comments" });
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("button", { name: "Review · 2" })).not.toBeInTheDocument();

    summary.focus();
    await userEvent.keyboard("{Enter}");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    const review = canvas.getByRole("button", { name: "Review · 2" });
    await userEvent.click(review);
    const popup = await screen.findByRole("dialog", { name: "Review comments" });
    await expect(within(popup).getByText(reviewComments[0]!.body)).toBeVisible();

    summary.focus();
    await userEvent.keyboard(" ");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull(),
    );
    await expect(canvas.queryByRole("button", { name: "Review · 2" })).not.toBeInTheDocument();
    await userEvent.click(summary);
    await expect(canvas.getByRole("button", { name: "Review · 2" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  },
};
