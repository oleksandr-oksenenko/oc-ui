import type { Meta } from "storybook-solidjs-vite";

import { DeleteSessionDialog } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar/DeleteSessionFlow/DeleteSessionDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";

const meta = {
  title: "Sessions/DeleteSessionDialog",
  component: DeleteSessionDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DeleteSessionDialog>;

export default meta;

function dialog(
  options: {
    readonly descendantCount?: number;
    readonly worktreeDirectory?: string;
    readonly error?: string;
  } = {},
) {
  return (
    <DialogStory>
      {() => (
        <DeleteSessionDialog
          title="Remove old experiment"
          descendantCount={options.descendantCount ?? 0}
          worktreeDirectory={options.worktreeDirectory}
          deleting={false}
          sessionRemoved={false}
          error={options.error}
          onDelete={() => undefined}
        />
      )}
    </DialogStory>
  );
}

export const SingleSession = {
  render: () => dialog(),
};

export const WithChildSessions = {
  render: () =>
    dialog({ descendantCount: 3, worktreeDirectory: "/worktrees/remove-old-experiment" }),
};

export const RequestFailure = {
  render: () =>
    dialog({ error: "The session could not be deleted. Check the connection and try again." }),
};
