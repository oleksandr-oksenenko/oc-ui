/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";

import { DeleteSessionDialog } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/DeleteSessionFlow/DeleteSessionDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";
import {
  expectConfirmationLayout,
  scrollToConfirmationAction,
  shortConfirmationViewport,
} from "./confirmation-dialog-fixtures.ts";

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
    readonly error?: string;
    readonly deleting?: boolean;
    readonly onDelete?: () => void;
  } = {},
) {
  return (
    <DialogStory>
      {() => (
        <DeleteSessionDialog
          title={options.title ?? "Remove old experiment"}
          descendantCount={options.descendantCount ?? 0}
          deleting={options.deleting ?? false}
          error={options.error}
          onDelete={options.onDelete ?? (() => undefined)}
        />
      )}
    </DialogStory>
  );
}

export const SingleSession = {
  render: () => dialog(),
};

export const WithChildSessions = {
  render: () => dialog({ descendantCount: 3 }),
};

export const RequestFailure = {
  render: () =>
    dialog({ error: "The session could not be deleted. Check the connection and try again." }),
};

export const Deleting = {
  render: () => dialog({ deleting: true, descendantCount: 3 }),
};

export const LongContent = {
  render: () =>
    dialog({
      title: "Investigate the intermittent renderer reconnection failure across remote workspaces",
      descendantCount: 128,
    }),
};

const onShortHeightDelete = fn();

export const ShortHeightLongError: StoryObj = {
  ...shortConfirmationViewport,
  render: () =>
    dialog({
      title: "Investigate renderer reconnection across remote workspaces. ".repeat(8),
      descendantCount: 128,
      error: "The session could not be deleted. Check the remote connection and try again. ".repeat(
        24,
      ),
      onDelete: onShortHeightDelete,
    }),
  play: async ({ canvasElement }) => {
    onShortHeightDelete.mockClear();
    const content = await expectConfirmationLayout(
      canvasElement.ownerDocument,
      ".delete-session-dialog",
      true,
    );
    await scrollToConfirmationAction(content, "Delete session");
    await expect(onShortHeightDelete).toHaveBeenCalledOnce();
  },
};

export const ShortHeightSingleSession: StoryObj = {
  ...shortConfirmationViewport,
  render: () => dialog(),
  play: async ({ canvasElement }) => {
    await expectConfirmationLayout(canvasElement.ownerDocument, ".delete-session-dialog", false);
  },
};

export const Narrow: StoryObj = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => dialog({ descendantCount: 3 }),
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    await within(document.body).findByRole("dialog");
    await waitFor(async () => {
      const container = document.querySelector(".delete-session-dialog");
      await expect(container).not.toBeNull();
      const rect = container!.getBoundingClientRect();
      await expect(rect.width).toBeLessThanOrEqual(
        Math.min(document.documentElement.clientWidth - 32, 440),
      );
      await expect(rect.left).toBeGreaterThanOrEqual(16);
      await expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth - 16);
    });
  },
};
