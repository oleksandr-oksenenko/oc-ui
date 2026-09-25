/* oxlint-disable effecttsgo/async-function */

import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { Show, createSignal, onCleanup, type Accessor } from "solid-js";
import { expect, screen, userEvent, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import { GlobalFormsRegion } from "../../src/renderer/components/App/ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { ServerFlowDialogProvider } from "../../src/renderer/ui/ServerFlowDialogProvider.tsx";
import {
  createFakeGlobalForms,
  defaultForms,
  emptyForms,
  hostileContentForm,
  type FakeControllerOptions,
} from "./global-form-fixtures.ts";
import { GlobalFormsShell } from "./global-forms.tsx";

import "./beacon.css";

const meta = {
  title: "Requests/Solution/Quiet beacon",
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
        setStatus("Live update: removed the last request. The queue remains reactive.");
      }, 2200),
    );
  };

  const sidebarControls = (visible: Accessor<boolean>) => (
    <GlobalFormsRegion
      controller={fixture.controller}
      visible={visible()}
      onOpenExternal={openExternal}
    />
  );

  return (
    <ServerFlowDialogProvider>
      <div class="global-forms-beacon-story">
        <GlobalFormsShell
          selectedTitle="Review requests"
          initialLeftSidebarOpen={props.initialLeftSidebarOpen}
          sidebarControls={sidebarControls}
        >
          <div class="global-forms-beacon-home">
            <div class="global-forms-beacon-home-icon" aria-hidden="true">
              <Icon name={props.syncState === "error" ? "warning" : "mcp"} />
            </div>
            <h1>{props.bodyTitle ?? "Requests are ready"}</h1>
            <p>
              {props.bodyDescription ??
                "Pending requests appear beside the server control in the session sidebar."}
            </p>
            <p class="global-forms-beacon-status" role="status">
              {status()}
            </p>
            <Show when={props.queueControls}>
              <div class="global-forms-beacon-controls" aria-label="Live queue controls">
                <span class="global-forms-beacon-controls-label">
                  Live queue demo · {fixture.forms().length} requests
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
                  Start this before opening the beacon. It adds a request, then removes one while
                  the dialog is open.
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
      bodyTitle="Live request queue"
      bodyDescription="Start the timed demo here, then open Requests beside the server control to watch its live count and list update."
    />
  ),
};

export const Loading = {
  render: () => (
    <BeaconStory
      forms={defaultForms}
      syncState="loading"
      bodyTitle="Loading requests"
      bodyDescription="The active workspace is loading its location-scoped requests."
    />
  ),
};

export const SyncError = {
  render: () => (
    <BeaconStory
      forms={defaultForms}
      syncState="error"
      syncError="The workspace service is unavailable."
      bodyTitle="Requests could not be loaded"
      bodyDescription="Open Requests beside the server control to retry the current queue."
    />
  ),
};

export const Disconnected = {
  render: () => (
    <BeaconStory
      forms={defaultForms.slice(0, 2)}
      connected={false}
      bodyTitle="Workspace disconnected"
      bodyDescription="Cached requests remain inspectable while responses wait for reconnection."
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
      bodyTitle="No requests"
      bodyDescription="There are no pending requests for this workspace location."
    />
  ),
};

export const LongHostileContent = {
  render: () => (
    <BeaconStory
      forms={[hostileContentForm]}
      bodyTitle="Long content stays contained"
      bodyDescription="Review the request to verify wrapping, scrolling, and action controls with hostile content."
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
      initialLeftSidebarOpen
      bodyTitle="Narrow workspace"
      bodyDescription="The request list and detail view adapt to a narrow viewport."
    />
  ),
};

export const ShortHeight = {
  parameters: { viewport: shortHeightViewport },
  globals: { viewport: { value: "short640x400", isRotated: false } },
  render: () => (
    <BeaconStory
      forms={defaultForms}
      initialLeftSidebarOpen
      bodyTitle="Short workspace"
      bodyDescription="The request detail remains usable when the viewport is short or zoomed in."
    />
  ),
  play: async ({ canvasElement }: { readonly canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Review .*requests/ }));

    const dialog = await screen.findByRole("dialog", { name: /^Review requests/ });
    const dialogCanvas = within(dialog);
    const layout = dialogCanvas.getByRole("region", { name: "Request details" });

    await expect(dialog).toBeVisible();
    await expect(dialogCanvas.getByRole("heading", { name: /^Review requests/ })).toBeVisible();
    await expect(
      dialogCanvas.getByRole("complementary", { name: "Pending requests" }),
    ).toBeVisible();
    await expect(layout).toBeVisible();
    await expect(dialogCanvas.getByRole("button", { name: "Keep pending" })).toBeVisible();
    await expect(layout.getBoundingClientRect().height).toBeGreaterThan(120);
  },
};
