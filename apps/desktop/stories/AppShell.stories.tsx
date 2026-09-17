/* oxlint-disable effecttsgo/async-function */

import { createEffect, createSignal } from "solid-js";
import { expect, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { createShellPanelState } from "../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import { ShellRegion } from "../src/renderer/components/App/ConnectedApp/Shell/ShellRegion.tsx";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { ChangesRegion } from "../src/renderer/components/App/ConnectedApp/Changes/ChangesRegion.tsx";
import { ContextTitlebarRegion } from "../src/renderer/components/App/ConnectedApp/Shell/ContextTitlebarRegion.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import { SessionSidebar } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { storyTranscript as transcript } from "./transcript-fixtures.ts";
import { storySession } from "./session-fixtures.ts";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";

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
    file: "src/renderer/components/Workspace.tsx",
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

const meta = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;
type StoryPlayContext = Parameters<NonNullable<StoryObj["play"]>>[0];
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
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([
    "workspace",
    "api",
    "tests",
  ]);
  const [draft, setDraft] = createSignal("Summarize the current layout changes");

  const toggleExpanded = (id: string) => {
    setExpandedIDs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div style={{ height: "100vh" }}>
      <ShellRegion
        panels={panelState}
        selectedTitle={() => "Test coverage"}
        rightControls={
          <ContextTitlebarRegion onClose={() => panelState.setRightPanelOpen(false)} />
        }
        sidebar={
          <SessionSidebar
            sessions={sessions}
            statusForSession={(id) => (id === "api" ? "running" : "idle")}
            selectedID="tests"
            expandedIDs={expandedIDs()}
            loading={false}
            canCreate={true}
            canDelete
            deletionStatusForSession={() => "ready"}
            autoFocusClose={panelState.mobile()}
            serverName="homie.lan:4096"
            serverStatus="connected"
            onSelect={() => {
              if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
            }}
            onToggleExpanded={toggleExpanded}
            onDelete={() => undefined}
            onCreate={() => undefined}
            onRetry={() => undefined}
            onHide={panelState.mobile() ? () => panelState.setLeftSidebarOpen(false) : undefined}
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
                action="running"
                modelSelection={composerModelSelection()}
                agentSelection={composerAgentSelection()}
                onInput={setDraft}
                onSubmit={() => setDraft("")}
                onStop={() => undefined}
              />
            }
          />
        }
        context={
          <ChangesRegion
            idBase={contextTabsId}
            changes={{ files: diffFiles, loading: false }}
            showTabs={panelState.mobile()}
            onClose={() => panelState.setRightPanelOpen(false)}
          />
        }
      />
    </div>
  );
}

export const Integrated = {
  render: () => IntegratedFixture(),
  play: async ({ canvasElement, step }: StoryPlayContext) => {
    const canvas = within(canvasElement);

    await step("Hide and restore the sessions sidebar", async () => {
      await expect(canvas.getByRole("complementary", { name: "Sessions" })).toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Hide sessions" }));
      await expect(
        canvas.queryByRole("complementary", { name: "Sessions" }),
      ).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Show sessions" }));
      await expect(canvas.getByRole("complementary", { name: "Sessions" })).toBeInTheDocument();
    });

    await step("Close and reopen workspace context", async () => {
      await expect(
        canvas.getByRole("complementary", { name: "Workspace context panel" }),
      ).toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Hide context panel" }));
      await expect(
        canvas.queryByRole("complementary", { name: "Workspace context panel" }),
      ).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole("button", { name: "Show context" }));
      await expect(
        canvas.getByRole("complementary", { name: "Workspace context panel" }),
      ).toBeInTheDocument();
    });
  },
};

const mobileGlobals = {
  viewport: { value: "mobile", isRotated: false },
};

const narrowGlobals = {
  viewport: { value: "narrow", isRotated: false },
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
                    action="send"
                    modelSelection={composerModelSelection()}
                    agentSelection={composerAgentSelection()}
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
  globals: narrowGlobals,
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
                canDelete
                deletionStatusForSession={() => "ready"}
                serverName="Local server"
                serverStatus="connected"
                onSelect={() => undefined}
                onToggleExpanded={() => undefined}
                onDelete={() => undefined}
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
                    action="send"
                    modelSelection={composerModelSelection()}
                    agentSelection={composerAgentSelection()}
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
  play: async ({ canvasElement }: StoryPlayContext) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector(".shell-titlebar")).not.toHaveClass("mobile");
    await expect(canvasElement.querySelector(".shell-workspace")).not.toHaveClass("mobile");
    await expect(canvas.getByRole("complementary", { name: "Sessions" })).toBeInTheDocument();
    await expect(
      canvas.getByRole("separator", { name: "Resize sessions sidebar" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("complementary", { name: "Workspace context panel" }),
    ).not.toBeInTheDocument();
  },
};

export const MobileTranscript = {
  globals: mobileGlobals,
  render: () => IntegratedFixture("transcript"),
  play: async ({ canvasElement, step }: StoryPlayContext) => {
    const canvas = within(canvasElement);
    const titlebar = canvasElement.querySelector<HTMLElement>(".shell-titlebar");
    const main = canvasElement.querySelector<HTMLElement>(".shell-main");

    if (!titlebar || !main) throw new Error("Mobile shell regions did not render");

    const expectOverlayIsolation = async () => {
      await expect(titlebar).toHaveAttribute("aria-hidden", "true");
      await expect(titlebar).toHaveAttribute("inert");
      await expect(titlebar.inert).toBe(true);
      await expect(main).toHaveAttribute("aria-hidden", "true");
      await expect(main).toHaveAttribute("inert");
      await expect(main.inert).toBe(true);
    };

    const expectShellRestored = async () => {
      await expect(titlebar).not.toHaveAttribute("aria-hidden");
      await expect(titlebar).not.toHaveAttribute("inert");
      await expect(titlebar.inert).toBe(false);
      await expect(main).not.toHaveAttribute("aria-hidden");
      await expect(main).not.toHaveAttribute("inert");
      await expect(main.inert).toBe(false);
    };

    const showSessions = canvas.getByRole("button", { name: "Show sessions" });
    const showContext = canvas.getByRole("button", { name: "Show context" });

    await step("Open and dismiss the sessions overlay with Escape", async () => {
      await userEvent.click(showSessions);
      const sessionsDialog = canvas.getByRole("dialog", { name: "Sessions" });
      await expect(
        within(sessionsDialog).getByRole("button", { name: "Hide sessions" }),
      ).toHaveFocus();
      await expect(sessionsDialog).toHaveAttribute("aria-modal", "true");
      await expect(
        canvas.queryByRole("dialog", { name: "Workspace context" }),
      ).not.toBeInTheDocument();
      await expectOverlayIsolation();

      await userEvent.keyboard("{Escape}");
      await expect(canvas.queryByRole("dialog", { name: "Sessions" })).not.toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Show sessions" })).toHaveFocus();
      await expectShellRestored();
    });

    await step("Open and dismiss the context overlay with Escape", async () => {
      await userEvent.click(showContext);
      const contextDialog = canvas.getByRole("dialog", { name: "Workspace context" });
      await expect(
        within(contextDialog).getByRole("button", { name: "Hide context panel" }),
      ).toHaveFocus();
      await expect(contextDialog).toHaveAttribute("aria-modal", "true");
      await expect(canvas.queryByRole("dialog", { name: "Sessions" })).not.toBeInTheDocument();
      await expectOverlayIsolation();

      await userEvent.keyboard("{Escape}");
      await expect(
        canvas.queryByRole("dialog", { name: "Workspace context" }),
      ).not.toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Show context" })).toHaveFocus();
      await expectShellRestored();
    });

    await step("Close each overlay from its own close control", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Show sessions" }));
      const sessionsDialog = canvas.getByRole("dialog", { name: "Sessions" });
      await expect(
        within(sessionsDialog).getByRole("button", { name: "Hide sessions" }),
      ).toHaveFocus();
      await expectOverlayIsolation();
      await userEvent.click(within(sessionsDialog).getByRole("button", { name: "Hide sessions" }));
      await expect(canvas.queryByRole("dialog", { name: "Sessions" })).not.toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Show sessions" })).toHaveFocus();
      await expectShellRestored();

      await userEvent.click(canvas.getByRole("button", { name: "Show context" }));
      const contextDialog = canvas.getByRole("dialog", { name: "Workspace context" });
      await expect(
        within(contextDialog).getByRole("button", { name: "Hide context panel" }),
      ).toHaveFocus();
      await expectOverlayIsolation();
      await userEvent.click(
        within(contextDialog).getByRole("button", { name: "Hide context panel" }),
      );
      await expect(
        canvas.queryByRole("dialog", { name: "Workspace context" }),
      ).not.toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Show context" })).toHaveFocus();
      await expectShellRestored();
    });
  },
};

export const MobileSessionsOverlay = {
  globals: mobileGlobals,
  render: () => IntegratedFixture("sessions"),
};

export const MobileContextOverlay = {
  globals: mobileGlobals,
  render: () => IntegratedFixture("context"),
};
