/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn } from "storybook/test";

import { CodeReviewRemovalDialog } from "../src/renderer/components/App/ConnectedApp/Review/ReviewRegion/CodeReviewRemovalDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";
import {
  expectConfirmationLayout,
  scrollToConfirmationAction,
  shortConfirmationViewport,
} from "./confirmation-dialog-fixtures.ts";

const meta = {
  title: "Review/CodeReviewRemovalDialog",
  component: CodeReviewRemovalDialog,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Discard code review?",
    description: "3 review comments will be permanently deleted.",
    confirmLabel: "Discard review",
    onConfirm: fn(),
  },
  render: (args) => <DialogStory>{() => <CodeReviewRemovalDialog {...args} />}</DialogStory>,
} satisfies Meta<typeof CodeReviewRemovalDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DiscardReview: Story = {};

export const ShortHeightLongDescription: Story = {
  ...shortConfirmationViewport,
  args: {
    title: `Discard review ${"RemoteWorkspace".repeat(8)}?`,
    description: "Review comments on this remote workspace will be permanently deleted. ".repeat(
      24,
    ),
  },
  play: async ({ canvasElement, args }) => {
    const content = await expectConfirmationLayout(
      canvasElement.ownerDocument,
      ".code-review-removal-dialog",
      true,
    );
    await scrollToConfirmationAction(content, "Discard review");
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};

export const LongDescriptionInspection: Story = {
  ...ShortHeightLongDescription,
  play: undefined,
};

export const ShortHeightDiscardReview: Story = {
  ...shortConfirmationViewport,
  play: async ({ canvasElement }) => {
    await expectConfirmationLayout(
      canvasElement.ownerDocument,
      ".code-review-removal-dialog",
      false,
    );
  },
};
