/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { useDialog } from "@opencode/ui/context/dialog";
import { Dialog, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog";
import { Show, createSignal } from "solid-js";

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
    await waitFor(async () => {
      await expect(dialog.isConnected).toBe(false);
      await expect(launcher).toHaveFocus();
    });
    await userEvent.click(launcher);
    const reopened = await screen.findByRole("dialog", { name: /^Review requests/ });
    await expect(reopened).toBeVisible();
    await userEvent.click(within(reopened).getByRole("button", { name: "Keep pending" }));
    await waitFor(async () => {
      await expect(reopened.isConnected).toBe(false);
      await expect(launcher).toHaveFocus();
    });
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

type FocusScenario = "remove opener" | "dispose owner" | "show replacement" | "push during close";

function FocusLifecycleHarness(props: { scenario: FocusScenario }) {
  const dialogs = useDialog();
  const [forms, setForms] = createSignal(defaultForms.slice(0, 1));
  const [regionMounted, setRegionMounted] = createSignal(true);
  const [disposedRoots, setDisposedRoots] = createSignal(0);
  const controller = { ...createFakeGlobalForms({ forms: forms() }), forms };
  const replacement = () => (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup title="Replacement" description="This dialog now owns keyboard focus." />
      </DialogHeader>
      <button autofocus onClick={() => dialogs.close()}>
        Close replacement
      </button>
    </Dialog>
  );
  const exerciseLifecycle = () => {
    const current = dialogs.active;
    if (!current) return;
    const dispose = current.dispose;
    current.dispose = () => {
      dispose();
      setDisposedRoots((count) => count + 1);
    };
    if (props.scenario === "remove opener") {
      setForms([]);
    } else if (props.scenario === "dispose owner") {
      setRegionMounted(false);
    } else if (props.scenario === "show replacement") {
      void dialogs.show(replacement);
    } else {
      dialogs.close();
      void dialogs.push(replacement);
    }
  };
  return (
    <div style={{ padding: "16px" }}>
      <div class="shell-session-sidebar">
        <Show when={regionMounted()}>
          <GlobalFormsRegion controller={controller} onOpenExternal={exerciseLifecycle} />
        </Show>
        <button class="shell-server-selector" disabled={props.scenario === "remove opener"}>
          Server fallback
        </button>
      </div>
      <div class="shell-titlebar">
        <button aria-label="Show sessions">Show sessions</button>
      </div>
      <output aria-label="Disposed dialog roots">{disposedRoots()}</output>
    </div>
  );
}

const focusLifecycleStory = (scenario: FocusScenario): Story => ({
  render: () => <FocusLifecycleHarness scenario={scenario} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const opener = canvas.getByRole("button", { name: /Review .*request/ });
    await userEvent.click(opener);
    const oldDialog = await screen.findByRole("dialog", { name: /^Review requests/ });
    // Observe the installed Kobalte focus-scope event on its detached content too.
    let closeFocusEvent: Event | undefined;
    oldDialog.addEventListener(
      "focusScope.autoFocusOnUnmount",
      (event) => {
        closeFocusEvent = event;
      },
      { once: true },
    );
    await userEvent.click(
      within(oldDialog).getByRole("button", { name: "Open Release checklist" }),
    );
    if (scenario === "remove opener") {
      await userEvent.click(within(oldDialog).getByRole("button", { name: "Keep pending" }));
    }
    await waitFor(async () => {
      await expect(canvas.getByLabelText("Disposed dialog roots")).toHaveTextContent("1");
      await expect(oldDialog.isConnected).toBe(false);
      await expect(closeFocusEvent?.defaultPrevented).toBe(true);
    });
    if (scenario === "remove opener") {
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Show sessions" })).toHaveFocus(),
      );
    } else if (scenario === "dispose owner") {
      await expect(opener.isConnected).toBe(false);
      await expect(canvas.getByRole("button", { name: "Server fallback" })).not.toHaveFocus();
      await expect(canvas.getByRole("button", { name: "Show sessions" })).not.toHaveFocus();
    } else {
      const next = await screen.findByRole("dialog", { name: "Replacement" });
      const close = within(next).getByRole("button", { name: "Close replacement" });
      await waitFor(() => expect(close).toHaveFocus());
      await expect(document.querySelectorAll("[data-dialog-layer]")).toHaveLength(1);
      await userEvent.click(close);
      await waitFor(async () => {
        await expect(screen.queryByRole("dialog")).toBeNull();
        await expect(document.querySelectorAll("[data-dialog-layer]")).toHaveLength(0);
      });
    }
  },
});

export const RemovedOpener: Story = { ...focusLifecycleStory("remove opener") };
export const DisposedLauncherOwner: Story = { ...focusLifecycleStory("dispose owner") };
export const ShowReplacement: Story = { ...focusLifecycleStory("show replacement") };
export const PushReplacementDuringClose: Story = { ...focusLifecycleStory("push during close") };
