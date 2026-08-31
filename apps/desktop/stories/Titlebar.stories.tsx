import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { ChangesTitlebarRegion } from "../src/renderer/components/App/ConnectedApp/Changes/ChangesTitlebarRegion.tsx";

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
        rightControls={<ChangesTitlebarRegion onClose={() => setRightPanelOpen(false)} />}
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
      rightControls={<ChangesTitlebarRegion onClose={() => undefined} />}
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
          rightControls={<ChangesTitlebarRegion onClose={() => undefined} />}
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
