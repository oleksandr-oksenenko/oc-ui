import type { Meta } from "storybook-solidjs-vite";

import { CodeReviewRemovalDialog } from "../src/renderer/components/App/ConnectedApp/Review/ReviewRegion/CodeReviewRemovalDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";

const meta = {
  title: "Review/CodeReviewRemovalDialog",
  component: CodeReviewRemovalDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CodeReviewRemovalDialog>;

export default meta;

export const DeleteComment = {
  render: () => (
    <DialogStory>
      {() => (
        <CodeReviewRemovalDialog
          title="Delete review comment?"
          description="This review comment will be permanently deleted."
          confirmLabel="Delete comment"
          onConfirm={() => undefined}
        />
      )}
    </DialogStory>
  ),
};

export const DiscardReview = {
  render: () => (
    <DialogStory>
      {() => (
        <CodeReviewRemovalDialog
          title="Discard code review?"
          description="3 review comments will be permanently deleted."
          confirmLabel="Discard review"
          onConfirm={() => undefined}
        />
      )}
    </DialogStory>
  ),
};
