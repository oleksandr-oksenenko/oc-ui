/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { PillsOption } from "./attachments/compact/PillsOption.tsx";
import { annotations, browserAnnotation, reviewComments } from "./attachment-fixtures.ts";

const meta = {
  title: "Transcript/Attachment options/Pills",
  component: PillsOption,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PillsOption>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div class="att-pills-story">
      <PillsOption />
    </div>
  ),
};

export const Narrow390: Story = {
  render: () => (
    <div class="att-pills-narrow">
      <PillsOption />
    </div>
  ),
};

export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => (
    <div class="att-pills-story">
      <PillsOption />
    </div>
  ),
};

export const Interactions: Story = {
  render: () => (
    <div class="att-pills-story">
      <PillsOption />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const review = canvas.getByRole("button", { name: "Review · 2" });
    review.focus();
    await userEvent.keyboard("{Enter}");
    await expect(review).toHaveAttribute("aria-expanded", "true");
    const reviewPopup = await screen.findByRole("dialog", { name: "Review comments" });
    await expect(within(reviewPopup).getByText(reviewComments[0]!.body)).toBeVisible();
    const multiline = reviewPopup.querySelectorAll<HTMLElement>(".attachment-pill-comment-body")[1];
    await expect(multiline?.innerText).toBe(reviewComments[1]!.body);
    await expect(reviewPopup.querySelector("pre")).toHaveAttribute("tabindex", "0");
    await userEvent.click(canvas.getByRole("button", { name: "Annotations · 1" }));
    await expect(review).toHaveAttribute("aria-expanded", "false");
    const annotationPopup = await screen.findByRole("dialog", { name: "Transcript annotation" });
    await expect(within(annotationPopup).getByText(`“${annotations[0]!.quote}”`)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Browser · 1" }));
    const browserPopup = await screen.findByRole("dialog", { name: "Browser annotation" });
    await expect(within(browserPopup).getByText(browserAnnotation.body)).toBeVisible();
    const image = within(browserPopup).getByRole("button", {
      name: `Enlarge ${browserAnnotation.image.name}`,
    });
    await userEvent.click(image);
    await expect(
      await screen.findByRole("dialog", { name: `Preview of ${browserAnnotation.image.name}` }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(image).toHaveFocus());
    await expect(browserPopup).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Browser annotation" })).toBeNull(),
    );
    await expect(canvas.getByRole("button", { name: "Browser · 1" })).toHaveFocus();
    await userEvent.click(review);
    await userEvent.click(canvas.getByText("requirements.pdf"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull(),
    );
  },
};
