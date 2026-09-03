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
    readonly error?: string;
    readonly deleting?: boolean;
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

const narrowViewport = {
  options: {
    mobile390: { name: "Mobile 390x760", styles: { width: "390px", height: "760px" } },
  },
};

export const Narrow = {
  parameters: { viewport: narrowViewport },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  render: () => dialog({ descendantCount: 3 }),
};
