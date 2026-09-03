import type { Meta } from "storybook-solidjs-vite";

import { DeleteSessionDialog } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/DeleteSessionFlow/DeleteSessionDialog.tsx";
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
    readonly title?: string;
    readonly worktreeDirectory?: string;
    readonly error?: string;
    readonly deleting?: boolean;
    readonly sessionRemoved?: boolean;
  } = {},
) {
  return (
    <DialogStory>
      {() => (
        <DeleteSessionDialog
          title={options.title ?? "Remove old experiment"}
          descendantCount={options.descendantCount ?? 0}
          worktreeDirectory={options.worktreeDirectory}
          deleting={options.deleting ?? false}
          sessionRemoved={options.sessionRemoved ?? false}
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

export const Deleting = {
  render: () => dialog({ deleting: true, descendantCount: 3 }),
};

export const SessionRemovedBeforeWorktreeCleanup = {
  render: () =>
    dialog({
      sessionRemoved: true,
      worktreeDirectory: "/srv/worktrees/remove-old-experiment",
      error:
        "The session was deleted, but the worktree could not be removed. Finish deletion to retry cleanup.",
    }),
};

export const LongContent = {
  render: () =>
    dialog({
      title: "Investigate the intermittent renderer reconnection failure across remote workspaces",
      descendantCount: 128,
      worktreeDirectory:
        "/srv/worktrees/teams/platform/renderer/investigate-intermittent-reconnection-failure",
    }),
};

export const Narrow = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => dialog({ descendantCount: 3, worktreeDirectory: "/srv/worktrees/old-session" }),
};
