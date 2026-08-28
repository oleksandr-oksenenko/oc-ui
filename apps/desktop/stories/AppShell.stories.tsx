import { Show, createEffect, createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/AppShell.tsx";
import { createShellPanelState } from "../src/renderer/components/App/ConnectedApp/AppShell/createShellPanelState.ts";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/AppShell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace.tsx";
import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel.tsx";
import {
  ContextTabs,
  type ContextPanelTab,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/ContextTabs.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/DiffView/DiffFile.tsx";
import type { FileTreeNode } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/ContextPanel/FilesView/FileTreeItem.tsx";
import { SessionSidebar } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import { storyTranscript as transcript } from "./transcript-fixtures.ts";
import { storySession } from "./session-fixtures.ts";
import { composerSelection } from "./composer-fixtures.ts";

const sessions = [
  storySession("workspace", "Workspace migration"),
  storySession("api", "API contract review", "workspace"),
  storySession("tests", "Test coverage", "api"),
  storySession("fixtures", "Fixtures", "tests"),
  storySession("docs", "Release notes", "workspace"),
  storySession("small-fix", "Small follow-up fix"),
];

const diffFiles: readonly DiffFileData[] = [
  {
    path: "src/renderer/components/Workspace.tsx",
    additions: 2,
    deletions: 1,
    status: "modified",
    patch: `diff --git a/src/renderer/components/Workspace.tsx b/src/renderer/components/Workspace.tsx
--- a/src/renderer/components/Workspace.tsx
+++ b/src/renderer/components/Workspace.tsx
@@ -28,2 +28,2 @@
   const layout = createLayout();
-  return <main class="workspace">
+  return <main class="workspace" data-layout={layout}>
`,
  },
];

const fileNodes: readonly FileTreeNode[] = [
  {
    id: "src",
    name: "src",
    kind: "directory",
    children: [
      {
        id: "src/renderer",
        name: "renderer",
        kind: "directory",
        children: [
          { id: "src/renderer/App.tsx", name: "App.tsx", kind: "file", status: "modified" },
          {
            id: "src/renderer/Workspace.tsx",
            name: "Workspace.tsx",
            kind: "file",
            status: "added",
          },
        ],
      },
    ],
  },
  { id: "docs", name: "component-inventory.md", kind: "file" },
];

const meta = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;
type MobileStoryState = "transcript" | "sessions" | "context";

function IntegratedFixture(mobileStoryState: MobileStoryState = "transcript") {
  const contextTabsId = "app-shell-workspace-context";
  const panelState = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  createEffect(() => {
    if (panelState.mobile()) {
      panelState.setLeftSidebarOpen(mobileStoryState === "sessions");
      panelState.setRightPanelOpen(mobileStoryState === "context");
    }
  });
  const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("diff");
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([
    "workspace",
    "api",
    "tests",
  ]);
  const [expandedFileIDs, setExpandedFileIDs] = createSignal<readonly string[]>([
    "src",
    "src/renderer",
  ]);
  const [draft, setDraft] = createSignal("Summarize the current layout changes");

  const toggleExpanded = (id: string) => {
    setExpandedIDs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleFileExpanded = (id: string) => {
    setExpandedFileIDs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div style={{ height: mobileStoryState === undefined ? "min(620px, 100vh)" : "100vh" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Test coverage"
            rightControls={
              <Show when={!panelState.mobile()}>
                <ContextTabs
                  activeTab={activeTab()}
                  idBase={contextTabsId}
                  onTabChange={setActiveTab}
                  onClose={() => panelState.setRightPanelOpen(false)}
                />
              </Show>
            }
            mobile={panelState.mobile()}
            leftSidebarOpen={panelState.leftSidebarOpen()}
            rightPanelOpen={panelState.rightPanelOpen()}
            rightPanelAvailable={true}
            onToggleLeftSidebar={panelState.toggleLeftSidebar}
            onToggleRightPanel={panelState.toggleRightPanel}
          />
        }
        workspace={
          <Workspace
            mobile={panelState.mobile()}
            leftSidebarOpen={panelState.leftSidebarOpen()}
            rightPanelOpen={panelState.rightPanelOpen()}
            sidebar={
              <SessionSidebar
                sessions={sessions}
                statusForSession={(id) => (id === "api" ? "running" : "idle")}
                selectedID="tests"
                expandedIDs={expandedIDs()}
                loading={false}
                canCreate={true}
                autoFocusClose={panelState.mobile()}
                serverName="homie.lan:4096"
                serverStatus="connected"
                onSelect={() => {
                  if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
                }}
                onToggleExpanded={toggleExpanded}
                onCreate={() => undefined}
                onRetry={() => undefined}
                onHide={
                  panelState.mobile() ? () => panelState.setLeftSidebarOpen(false) : undefined
                }
                onSelectServer={() => undefined}
              />
            }
            main={
              <SessionPane
                selected
                title="Test coverage"
                transcript={
                  <TranscriptView
                    sessionID="integrated"
                    messages={transcript}
                    loading={false}
                    sessionStatus="running"
                  />
                }
                composer={
                  <Composer
                    value={draft()}
                    disabled={false}
                    submitting={false}
                    running={false}
                    selection={composerSelection()}
                    onInput={setDraft}
                    onSubmit={() => setDraft("")}
                  />
                }
              />
            }
            context={
              <ContextPanel
                activeTab={activeTab()}
                onTabChange={setActiveTab}
                onClose={() => panelState.setRightPanelOpen(false)}
                showTabs={panelState.mobile()}
                autoFocusClose={panelState.mobile()}
                tabsIdBase={contextTabsId}
                diff={{ files: diffFiles, loading: false }}
                files={{
                  nodes: fileNodes,
                  loading: false,
                  expandedIDs: expandedFileIDs(),
                  onToggleExpanded: toggleFileExpanded,
                }}
              />
            }
          />
        }
      />
    </div>
  );
}

export const Integrated = {
  render: () => IntegratedFixture(),
};

const mobileViewport = {
  options: {
    mobile390: { name: "Mobile 390x760", styles: { width: "390px", height: "760px" } },
  },
};

const mobileGlobals = {
  viewport: { value: "mobile390", isRotated: false },
};

export const MainOnly = {
  render: () => (
    <div style={{ height: "320px" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="No context panel"
            leftSidebarOpen={false}
            rightPanelOpen={false}
            rightPanelAvailable={false}
            onToggleLeftSidebar={() => undefined}
            onToggleRightPanel={() => undefined}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen={false}
            rightPanelOpen={true}
            main={
              <SessionPane
                selected
                title="No context panel"
                transcript={
                  <TranscriptView
                    sessionID="main-only"
                    messages={transcript}
                    loading={false}
                    sessionStatus="idle"
                  />
                }
                composer={
                  <Composer
                    value="Ask about the selected session"
                    disabled={false}
                    submitting={false}
                    running={false}
                    selection={composerSelection()}
                    onInput={() => undefined}
                    onSubmit={() => undefined}
                  />
                }
              />
            }
          />
        }
      />
    </div>
  ),
};

export const NarrowRightPanelCollapsed = {
  render: () => (
    <div style={{ width: "760px", height: "540px" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Narrow workspace"
            leftSidebarOpen={true}
            rightPanelOpen={false}
            rightPanelAvailable={true}
            onToggleLeftSidebar={() => undefined}
            onToggleRightPanel={() => undefined}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen={true}
            rightPanelOpen={false}
            sidebar={
              <SessionSidebar
                sessions={sessions}
                statusForSession={(id) => (id === "api" ? "running" : "idle")}
                selectedID="tests"
                expandedIDs={["workspace", "api", "tests"]}
                loading={false}
                canCreate={true}
                serverName="Local server"
                serverStatus="connected"
                onSelect={() => undefined}
                onToggleExpanded={() => undefined}
                onCreate={() => undefined}
                onRetry={() => undefined}
                onSelectServer={() => undefined}
              />
            }
            main={
              <SessionPane
                selected
                title="Narrow workspace"
                transcript={
                  <TranscriptView
                    sessionID="narrow"
                    messages={transcript}
                    loading={false}
                    sessionStatus="idle"
                  />
                }
                composer={
                  <Composer
                    value="Keep this narrow layout readable"
                    disabled={false}
                    submitting={false}
                    running={false}
                    selection={composerSelection()}
                    onInput={() => undefined}
                    onSubmit={() => undefined}
                  />
                }
              />
            }
          />
        }
      />
    </div>
  ),
};

export const MobileTranscript = {
  parameters: { viewport: mobileViewport },
  globals: mobileGlobals,
  render: () => IntegratedFixture("transcript"),
};

export const MobileSessionsOverlay = {
  parameters: { viewport: mobileViewport },
  globals: mobileGlobals,
  render: () => IntegratedFixture("sessions"),
};

export const MobileContextOverlay = {
  parameters: { viewport: mobileViewport },
  globals: mobileGlobals,
  render: () => IntegratedFixture("context"),
};
