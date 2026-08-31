import type { FormInfo } from "@opencode-ai/client";

export const workspaceQuestionForm = {
  id: "frm_workspace_scope",
  sessionID: "ses_oc_ui",
  title: "Where should I make this change?",
  fields: [
    {
      key: "scope",
      type: "string",
      title: "Choose a workspace",
      description: "The agent will continue in the selected location.",
      required: true,
      custom: true,
      options: [
        {
          value: "current",
          label: "Current worktree",
          description: "Continue in /Users/alex/code/oc-ui.",
        },
        {
          value: "isolated",
          label: "New worktree",
          description: "Keep the change isolated from current work.",
        },
      ],
    },
  ],
} satisfies FormInfo;
