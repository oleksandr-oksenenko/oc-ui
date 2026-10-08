/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { ContextTitlebarRegion } from "../src/renderer/components/App/ConnectedApp/Shell/ContextTitlebarRegion.tsx";
import { SessionHeader } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionHeader.tsx";

const meta = {
  title: "Shell/Titlebar",
  component: Titlebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Titlebar>;

export default meta;
function interactiveTitlebar() {
  const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(false);
  const [rightPanelOpen, setRightPanelOpen] = createSignal(false);

  return (
    <div style={{ width: "100%", "min-width": "720px" }}>
      <Titlebar
        selectedTitle="API contract review"
        rightControls={<ContextTitlebarRegion onClose={() => setRightPanelOpen(false)} />}
        leftSidebarOpen={leftSidebarOpen()}
        rightPanelOpen={rightPanelOpen()}
        rightPanelAvailable={true}
        onToggleLeftSidebar={() => setLeftSidebarOpen((value) => !value)}
        onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
      />
    </div>
  );
}

export const PanelsHidden = {
  render: () => interactiveTitlebar(),
};

export const BothPanelsHidden = {
  render: () => (
    <Titlebar
      selectedTitle="A long selected session title is truncated cleanly"
      leftSidebarOpen={false}
      rightPanelOpen={false}
      rightPanelAvailable={true}
      onToggleLeftSidebar={() => undefined}
      onToggleRightPanel={() => undefined}
    />
  ),
};

export const NoSessionSelected = {
  render: () => (
    <Titlebar
      rightControls={<ContextTitlebarRegion onClose={() => undefined} />}
      leftSidebarOpen={true}
      rightPanelOpen={true}
      rightPanelAvailable={true}
      onToggleLeftSidebar={() => undefined}
      onToggleRightPanel={() => undefined}
    />
  ),
};

export const MacOSLayout = {
  render: () => {
    return (
      <div data-platform="macos" style={{ width: "100%", "min-width": "720px" }}>
        <Titlebar
          selectedTitle="Compact Ledger Transcript"
          rightControls={<ContextTitlebarRegion onClose={() => undefined} />}
          leftSidebarOpen={true}
          rightPanelOpen={true}
          rightPanelAvailable={true}
          onToggleLeftSidebar={() => undefined}
          onToggleRightPanel={() => undefined}
        />
      </div>
    );
  },
};

export const NarrowNativeControls = {
  parameters: {
    viewport: {
      options: {
        native720: { name: "Native minimum 720x900", styles: { width: "720px", height: "900px" } },
      },
    },
  },
  globals: { viewport: { value: "native720", isRotated: false } },
  render: () => {
    const [leftOpen, setLeftOpen] = createSignal(true);
    const [rightOpen, setRightOpen] = createSignal(true);
    const [view, setView] = createSignal<"diff" | "browser">("diff");
    const [created, setCreated] = createSignal(0);
    return (
      <div style={{ height: "100dvh" }}>
        <AppShell
          titlebar={
            <Titlebar
              selectedTitle="Native minimum-width controls"
              leftSidebarOpen={leftOpen()}
              rightPanelOpen={rightOpen()}
              rightPanelAvailable
              onToggleLeftSidebar={() => setLeftOpen((open) => !open)}
              onToggleRightPanel={() => setRightOpen((open) => !open)}
              sidebarActions={
                <SessionHeader canCreate onCreate={() => setCreated((count) => count + 1)} />
              }
              rightControls={
                <ContextTitlebarRegion
                  browserAvailable
                  view={view()}
                  onViewChange={setView}
                  onClose={() => setRightOpen(false)}
                />
              }
            />
          }
          workspace={
            <Workspace
              leftSidebarOpen={leftOpen()}
              rightPanelOpen={rightOpen()}
              sidebar={
                <aside aria-label="Sessions">
                  <p>Saved sessions</p>
                </aside>
              }
              main={<output aria-label="Created sessions">{created()}</output>}
              context={
                <aside aria-label="Workspace context panel">
                  <p>Workspace content</p>
                </aside>
              }
            />
          }
        />
      </div>
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const region = (selector: string) => canvasElement.querySelector<HTMLElement>(selector)!;
    const left = region(".titlebar-left-region");
    const right = region(".titlebar-right-region");
    const checkControls = async () => {
      await waitFor(async () => {
        const hide = canvas.getByRole("button", { name: "Hide sessions" });
        const create = canvas.getByRole("button", { name: "Create session" });
        const diff = canvas.getByRole("button", { name: "Diff" });
        const browser = canvas.getByRole("button", { name: "Browser" });
        const close = canvas.getByRole("button", { name: "Hide context panel" });
        for (const [bounds, controls] of [
          [left.getBoundingClientRect(), [hide, create]],
          [right.getBoundingClientRect(), [diff, browser, close]],
        ] as const) {
          for (const control of controls) {
            const rect = control.getBoundingClientRect();
            await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
            await expect(rect.right).toBeLessThanOrEqual(bounds.right);
            await expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
            await expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
            for (const x of [rect.left + 1, rect.right - 1]) {
              await expect(
                control.contains(
                  control.ownerDocument.elementFromPoint(x, rect.top + rect.height / 2),
                ),
              ).toBe(true);
            }
          }
          for (let index = 1; index < controls.length; index++) {
            await expect(controls[index - 1]!.getBoundingClientRect().right).toBeLessThanOrEqual(
              controls[index]!.getBoundingClientRect().left,
            );
          }
        }
        const hideBounds = hide.getBoundingClientRect();
        const createBounds = create.getBoundingClientRect();
        await expect(hideBounds.left).toBe(76);
        await expect(hideBounds.width).toBe(24);
        await expect(hideBounds.height).toBe(24);
        await expect(createBounds.width).toBe(24);
        await expect(createBounds.height).toBe(24);
        await expect(createBounds.top).toBe(hideBounds.top);
        await expect(close.getBoundingClientRect().top).toBe(hideBounds.top);
        await expect(close.getBoundingClientRect().width).toBe(28);
        await expect(close.getBoundingClientRect().height).toBe(28);
      });
    };

    await expect(window.innerWidth).toBe(720);
    await expect(left.getBoundingClientRect().width).toBeCloseTo(132, 1);
    await expect(right.getBoundingClientRect().width).toBeCloseTo(168, 1);
    await expect(region(".shell-left-sidebar").getBoundingClientRect().width).toBeCloseTo(132, 1);
    await expect(region(".shell-right-panel").getBoundingClientRect().width).toBeCloseTo(168, 1);
    await checkControls();
    await userEvent.click(canvas.getByRole("button", { name: "Create session" }));
    await expect(canvas.getByLabelText("Created sessions")).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Browser" }));
    await expect(canvas.getByRole("button", { name: "Browser" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Diff" }));
    await expect(canvas.getByRole("button", { name: "Diff" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Closing context grows the sessions track and restores its ordinary padding.
    await userEvent.click(canvas.getByRole("button", { name: "Hide context panel" }));
    await expect(
      canvas.queryByRole("complementary", { name: "Workspace context panel" }),
    ).toBeNull();
    await expect(left.getBoundingClientRect().width).toBeGreaterThan(132);
    const create = canvas.getByRole("button", { name: "Create session" });
    await expect(left.getBoundingClientRect().right - create.getBoundingClientRect().right).toBe(9);
    await userEvent.click(create);
    await expect(canvas.getByLabelText("Created sessions")).toHaveTextContent("2");
    await userEvent.click(canvas.getByRole("button", { name: "Show context" }));
    await checkControls();

    await userEvent.click(canvas.getByRole("button", { name: "Hide sessions" }));
    await expect(canvas.queryByRole("complementary", { name: "Sessions" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Show sessions" }));
    await checkControls();
    await userEvent.click(canvas.getByRole("button", { name: "Create session" }));
    await expect(canvas.getByLabelText("Created sessions")).toHaveTextContent("3");
  },
};

export const OrdinaryNativeControls = {
  render: NarrowNativeControls.render,
  globals: { viewport: { value: "desktop", isRotated: false } },
};
