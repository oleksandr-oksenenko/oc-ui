import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  DispatchReturn,
  NotebookReturn,
  NotebookReview,
  WorkbenchAttentionFilter,
  WorkbenchReturn,
  WorkbenchReview,
} from "./ScenarioLab.tsx";
import { WorkbenchSupervision } from "./SupervisionLab.tsx";
import { WorkbenchApprovalUncertainty } from "./ApprovalLab.tsx";

const meta = {
  title: "Scenario Lab",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "One scenario across three compositions. A session has been working for several minutes, one command failed, four files changed, and a second session is waiting on a permission decision. The 'Coming back' moment is the user returning to the desk after leaving the agents running. Compare shapes and hierarchy, not polish.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const WorkbenchReturnStory = {
  name: "Workbench / Coming back",
  render: () => <WorkbenchReturn />,
} satisfies Story;

export const WorkbenchReviewStory = {
  name: "Workbench / Review (expand from the panel)",
  render: () => <WorkbenchReview />,
} satisfies Story;

export const WorkbenchAttentionFilterStory = {
  name: "Workbench / Needs you filter",
  render: () => <WorkbenchAttentionFilter />,
} satisfies Story;

export const WorkbenchSupervisionStory = {
  name: "Workbench / Back after two hours",
  render: () => <WorkbenchSupervision />,
} satisfies Story;

export const WorkbenchApprovalStory = {
  name: "Workbench / Did that approval go through?",
  render: () => <WorkbenchApprovalUncertainty />,
} satisfies Story;

export const NotebookReturnStory = {
  name: "Notebook / Coming back",
  render: () => <NotebookReturn />,
} satisfies Story;

export const NotebookReviewStory = {
  name: "Notebook / Review",
  render: () => <NotebookReview />,
} satisfies Story;

export const DispatchDecisionStory = {
  name: "Dispatch / Needs input",
  render: () => <DispatchReturn />,
} satisfies Story;
