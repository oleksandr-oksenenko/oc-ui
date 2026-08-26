import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { Titlebar } from "../src/renderer/components/App/ConnectedApp/AppShell/Titlebar.tsx";
import {
  ContextTabs,
  type ContextPanelTab,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/ContextTabs.tsx";
import { SessionHeader } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar/SessionHeader.tsx";

const meta = {
  title: "Shell/Titlebar",
  component: Titlebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Titlebar>;

export default meta;
function interactiveTitlebar() {
  const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(false);
  const [rightPanelOpen, setRightPanelOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("diff");

  return (
    <div style={{ width: "100%", "min-width": "720px" }}>
      <Titlebar
        selectedTitle="API contract review"
        leftControls={
          <SessionHeader
            canCreate
            creating={false}
            onCreate={() => undefined}
            onHide={() => setLeftSidebarOpen(false)}
          />
        }
        rightControls={
          <ContextTabs
            activeTab={activeTab()}
            onTabChange={setActiveTab}
            onClose={() => setRightPanelOpen(false)}
          />
        }
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
  render: () => {
    const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("diff");
    return (
      <Titlebar
        leftControls={
          <SessionHeader
            canCreate
            creating={false}
            onCreate={() => undefined}
            onHide={() => undefined}
          />
        }
        rightControls={
          <ContextTabs
            activeTab={activeTab()}
            onTabChange={setActiveTab}
            onClose={() => undefined}
          />
        }
        leftSidebarOpen={true}
        rightPanelOpen={true}
        rightPanelAvailable={true}
        onToggleLeftSidebar={() => undefined}
        onToggleRightPanel={() => undefined}
      />
    );
  },
};

export const MacOSLayout = {
  render: () => {
    const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("diff");
    return (
      <div data-platform="macos" style={{ width: "100%", "min-width": "720px" }}>
        <Titlebar
          selectedTitle="Compact Ledger Transcript"
          leftControls={
            <SessionHeader
              canCreate
              creating={false}
              onCreate={() => undefined}
              onHide={() => undefined}
            />
          }
          rightControls={
            <ContextTabs
              activeTab={activeTab()}
              onTabChange={setActiveTab}
              onClose={() => undefined}
            />
          }
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
