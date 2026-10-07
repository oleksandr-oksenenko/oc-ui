/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { GlobalFormsRegion } from "../../src/renderer/components/App/ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import {
  createFakeGlobalForms,
  defaultForms,
  hostileContentForm,
  type FakeControllerOptions,
} from "./global-form-fixtures.ts";

const renderForms =
  (options: FakeControllerOptions = {}) =>
  () => (
    <div style={{ padding: "16px" }}>
      <GlobalFormsRegion controller={createFakeGlobalForms(options)} visible />
    </div>
  );

const meta = {
  title: "Requests/GlobalFormsRegion",
  component: GlobalFormsRegion,
  parameters: { layout: "fullscreen" },
  render: renderForms(),
} satisfies Meta<typeof GlobalFormsRegion>;
export default meta;
// The render harness creates reactive fixture controllers per mount.
type Story = StoryObj;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const launcher = within(canvasElement).getByRole("button", { name: /Review .*requests/ });
    await userEvent.click(launcher);
    const dialog = await screen.findByRole("dialog", { name: /^Review requests/ });
    await expect(within(dialog).getByRole("region", { name: "Request details" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(launcher).toHaveFocus());
    await userEvent.click(launcher);
    await expect(await screen.findByRole("dialog", { name: /^Review requests/ })).toBeVisible();
  },
};
export const Loading: Story = { render: renderForms({ syncState: "loading" }) };
export const SyncError: Story = { render: renderForms({ syncState: "error" }) };
export const Disconnected: Story = { render: renderForms({ connected: false }) };
export const ActionFailure: Story = {
  render: renderForms({ forms: [defaultForms[0]!], replyFailures: { [defaultForms[0]!.id]: 1 } }),
};
export const Empty: Story = { render: renderForms({ forms: [] }) };
export const LongContent: Story = { render: renderForms({ forms: [hostileContentForm] }) };
export const Narrow: Story = {
  ...Default,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const ShortHeight: Story = {
  parameters: {
    viewport: {
      options: {
        short640x400: { name: "Short 640x400", styles: { width: "640px", height: "400px" } },
      },
    },
  },
  globals: { viewport: { value: "short640x400", isRotated: false } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Review .*requests/ }));
    const dialog = await screen.findByRole("dialog", { name: /^Review requests/ });
    const canvas = within(dialog);
    const details = canvas.getByRole("region", { name: "Request details" });
    await expect(canvas.getByRole("complementary", { name: "Pending requests" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Keep pending" })).toBeVisible();
    await expect(details.getBoundingClientRect().height).toBeGreaterThan(120);
  },
};
