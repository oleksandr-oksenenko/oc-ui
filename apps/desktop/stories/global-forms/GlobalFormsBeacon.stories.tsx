/* oxlint-disable effecttsgo/async-function */

import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { Show, createSignal, onCleanup } from "solid-js";
import { expect, screen, userEvent, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import { GlobalFormsRegion } from "../../src/renderer/components/App/ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { ServerFlowDialogProvider } from "../../src/renderer/ui/ServerFlowDialogProvider.tsx";
import {
  createFakeGlobalForms,
  defaultForms,
  emptyForms,
  hostileContentForm,
  GLOBAL_FORM_LOCATION,
  type FakeControllerOptions,
} from "./global-form-fixtures.ts";
import { GlobalFormsShell } from "./global-forms.tsx";

import "./beacon.css";

const meta = {
  title: "Global forms/Solution/Quiet beacon",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type BeaconStoryProps = FakeControllerOptions & {
  readonly bodyTitle?: string;
  readonly bodyDescription?: string;
  readonly queueControls?: boolean;
  readonly initialLeftSidebarOpen?: boolean;
};

function BeaconStory(props: BeaconStoryProps) {
  const fixture = createFakeGlobalForms(props);
  const [status, setStatus] = createSignal("No story action yet.");
  const liveDemoTimers: number[] = [];

  onCleanup(() => {
    for (const timer of liveDemoTimers) window.clearTimeout(timer);
  });

  const openExternal = (url: string) => {
    setStatus(`External link callback recorded for ${url}. No navigation was performed.`);
  };

  const startLiveQueueDemo = () => {
    for (const timer of liveDemoTimers) window.clearTimeout(timer);
    liveDemoTimers.length = 0;
    setStatus("Live demo started. Open the beacon now; the queue will update in this dialog.");
    liveDemoTimers.push(
      window.setTimeout(() => {
        const created = fixture.addForm();
        setStatus(`Live update: added “${created.title}”.`);
      }, 900),
    );
    liveDemoTimers.push(
      window.setTimeout(() => {
        fixture.removeLastForm();
        setStatus("Live update: removed the last global form. The queue remains reactive.");
      }, 2200),
    );
  };

  return (
    <ServerFlowDialogProvider>
      <div class="global-forms-beacon-story">
        <GlobalFormsShell
          selectedTitle="Review global forms"
          initialLeftSidebarOpen={props.initialLeftSidebarOpen}
          globalControls={
            <GlobalFormsRegion controller={fixture.controller} onOpenExternal={openExternal} />
          }
        >
          <div class="global-forms-beacon-home">
            <div class="global-forms-beacon-home-icon" aria-hidden="true">
              <Icon name={props.syncState === "error" ? "warning" : "mcp"} />
            </div>
            <h1>{props.bodyTitle ?? "Global forms are ready"}</h1>
            <p>
              {props.bodyDescription ??
                "Pending global forms stay quiet in the titlebar until you choose to review them."}
            </p>
            <p class="global-forms-beacon-story-note">
              Location: <code>{GLOBAL_FORM_LOCATION.directory}</code> · workspace demo
            </p>
            <p class="global-forms-beacon-status" role="status">
              {status()}
            </p>
            <Show when={props.queueControls}>
              <div class="global-forms-beacon-controls" aria-label="Live queue controls">
                <span class="global-forms-beacon-controls-label">
                  Live queue demo · {fixture.forms().length} forms
                </span>
                <Button
                  class="global-forms-beacon-control-button"
                  type="button"
                  variant="outline"
                  onClick={startLiveQueueDemo}
                >
                  Start live demo
                </Button>
                <span class="global-forms-beacon-controls-note">
                  Start this before opening the beacon. It adds a global form, then removes one
                  while the dialog is open.
                </span>
              </div>
            </Show>
          </div>
        </GlobalFormsShell>
      </div>
    </ServerFlowDialogProvider>
  );
}

export const DefaultInteractive = {
  render: () => <BeaconStory forms={defaultForms} />,
  play: ({ canvasElement }: { readonly canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLButtonElement>(".global-forms-region-button")?.click();
  },
};

export const LiveQueue = {
  render: () => (
    <BeaconStory
      forms={defaultForms.slice(0, 2)}
      queueControls
      bodyTitle="Live global form queue"
      bodyDescription="Start the timed demo here, then open the titlebar beacon to watch its live count and list update."
    />
  ),
};

export const Loading = {
  render: () => (
    <BeaconStory
      forms={defaultForms}
      syncState="loading"
      bodyTitle="Loading global forms"
      bodyDescription="The active workspace is loading its location-scoped global forms."
    />
  ),
};

export const SyncError = {
  render: () => (
    <BeaconStory
      forms={defaultForms}
      syncState="error"
      syncError="The workspace service is unavailable."
      bodyTitle="Global forms could not be loaded"
      bodyDescription="Use Retry in the titlebar beacon to request the current queue again."
    />
  ),
};

export const Disconnected = {
  render: () => (
    <BeaconStory
      forms={defaultForms.slice(0, 2)}
      connected={false}
      bodyTitle="Workspace disconnected"
      bodyDescription="Cached global forms remain inspectable while responses wait for reconnection."
    />
  ),
};

export const ActionFailure = {
  render: () => (
    <BeaconStory
      forms={[
        {
          ...defaultForms[0]!,
          id: "frm_action-failure",
          title: "Submit a request that can be retried",
        },
      ]}
      replyFailures={{ "frm_action-failure": 1 }}
      bodyTitle="Retryable request action"
      bodyDescription="The first answer fails and remains visible with its draft. Submit it again to complete the request."
    />
  ),
};

export const Empty = {
  render: () => (
    <BeaconStory
      forms={emptyForms}
      bodyTitle="No global forms"
      bodyDescription="There are no pending global forms for this workspace location."
    />
  ),
};

export const LongHostileContent = {
  render: () => (
    <BeaconStory
      forms={[hostileContentForm]}
      bodyTitle="Long content stays contained"
      bodyDescription="Review the global form to verify wrapping, scrolling, and action controls with hostile content."
    />
  ),
};

const shortHeightViewport = {
  options: {
    short640x400: { name: "Short 640x400", styles: { width: "640px", height: "400px" } },
  },
};

export const NarrowViewport = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => (
    <BeaconStory
      forms={defaultForms.slice(0, 2)}
      initialLeftSidebarOpen={false}
      bodyTitle="Narrow workspace"
      bodyDescription="The global form list and detail view adapt to a narrow viewport."
    />
  ),
};

export const ShortHeight = {
  parameters: { viewport: shortHeightViewport },
  globals: { viewport: { value: "short640x400", isRotated: false } },
  render: () => (
    <BeaconStory
      forms={defaultForms}
      initialLeftSidebarOpen={false}
      bodyTitle="Short workspace"
      bodyDescription="The global form detail remains usable when the viewport is short or zoomed in."
    />
  ),
  play: async ({ canvasElement }: { readonly canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Review .*global forms/ }));

    const dialog = await screen.findByRole("dialog", { name: /^Review global forms/ });
    const dialogCanvas = within(dialog);
    const layout = dialogCanvas.getByRole("region", { name: "Global form details" });

    await expect(dialog).toBeVisible();
    await expect(dialogCanvas.getByRole("heading", { name: /^Review global forms/ })).toBeVisible();
    await expect(
      dialogCanvas.getByRole("complementary", { name: "Pending global forms" }),
    ).toBeVisible();
    await expect(layout).toBeVisible();
    await expect(dialogCanvas.getByRole("button", { name: "Keep pending" })).toBeVisible();
    await expect(layout.getBoundingClientRect().height).toBeGreaterThan(120);
  },
};
