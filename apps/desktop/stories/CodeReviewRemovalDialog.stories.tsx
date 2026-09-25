import type { Meta } from "storybook-solidjs-vite";

import { CodeReviewRemovalDialog } from "../src/renderer/components/App/ConnectedApp/Review/ReviewRegion/CodeReviewRemovalDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";

const meta = {
  title: "Review/CodeReviewRemovalDialog",
  component: CodeReviewRemovalDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CodeReviewRemovalDialog>;

export default meta;

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
