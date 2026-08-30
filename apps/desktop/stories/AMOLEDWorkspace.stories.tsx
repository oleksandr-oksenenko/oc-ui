import { Show, createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { createShellPanelState } from "../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import { ContextTabs } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/ContextTabs.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView/DiffFile.tsx";
import { SessionSidebar } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { QuestionForm } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/QuestionForm.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { storyTranscript as transcript } from "./transcript-fixtures.ts";
import { storySession } from "./session-fixtures.ts";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";
import { workspaceQuestionForm } from "./question-form-fixtures.ts";

const sessions = [
  storySession("compact-ledger", "Compact Ledger Transcript"),
  storySession("refactor-utils", "Refactor Utils"),
  storySession("rename-helpers", "Rename Helpers", "refactor-utils"),
  storySession("extract-hooks", "Extract Hooks", "refactor-utils"),
  storySession("investigate-bug", "Investigate Bug"),
  storySession("reproduce-issue", "Reproduce Issue", "investigate-bug"),
  storySession("trace-root-cause", "Trace Root Cause", "investigate-bug"),
  storySession("collect-logs", "Collect Logs", "trace-root-cause"),
  storySession("analyze-stack", "Analyze Stack", "trace-root-cause"),
  storySession("config-option", "Add Config Option"),
  storySession("prototype-api", "Prototype API"),
  storySession("design-schema", "Design Schema", "prototype-api"),
  storySession("implement-endpoints", "Implement Endpoints", "prototype-api"),
  storySession("auth-layer", "Auth Layer", "implement-endpoints"),
  storySession("error-handling", "Error Handling", "implement-endpoints"),
  storySession("ui-polish", "UI Polish"),
  storySession("layout-updates", "Layout Updates", "ui-polish"),
  storySession("typography", "Typography", "ui-polish"),
  storySession("spacing-density", "Spacing & Density", "ui-polish"),
  storySession("improve-docs", "Improve Docs"),
  storySession("update-tests", "Update Tests"),
  storySession("unit-tests", "Unit Tests", "update-tests"),
  storySession("integration-tests", "Integration Tests", "update-tests"),
  storySession("fix-login", "Fix Login Flow"),
  storySession("integrate-stripe", "Integrate Stripe"),
  storySession("optimize-query", "Optimize Query"),
  storySession("security-audit", "Security Audit"),
];

const diff: readonly DiffFileData[] = [
  {
    path: "lazygit/config.yml",
    additions: 2,
    deletions: 2,
    status: "modified",
    defaultExpanded: true,
    patch: `diff --git a/lazygit/config.yml b/lazygit/config.yml
--- a/lazygit/config.yml
+++ b/lazygit/config.yml
@@ -8,6 +8,6 @@
     reverse: true
     notARepo: 'skip'
   git:
-    pagers:
+    diffRenderers:
       colorArg: always
-      pager: '~/.config/git/delta-theme --paging=never'
+      command: '~/.config/git/delta-theme --paging=never'
`,
  },
  {
    path: "nix/hosts/personal/flake.lock",
    additions: 39,
    deletions: 39,
    status: "modified",
    defaultExpanded: true,
    patch: `diff --git a/nix/hosts/personal/flake.lock b/nix/hosts/personal/flake.lock
--- a/nix/hosts/personal/flake.lock
+++ b/nix/hosts/personal/flake.lock
@@ -186,8 +186,8 @@
       "locked": {
-        "lastModified": 1785627969,
-        "narHash": "sha256-4doxXwMulePeqvVn...",
+        "lastModified": 1787559586,
+        "narHash": "sha256-onuMeLWoYp7...",
         "owner": "hercules-ci",
         "repo": "flake-parts",
-        "rev": "420b74bd94355fdf..."
+        "rev": "90d87a72c2374f89..."
         "type": "github"
`,
  },
  {
    path: "src/components/SessionList.test.tsx",
    additions: 4,
    deletions: 1,
    status: "modified",
    defaultExpanded: false,
    patch: `diff --git a/src/components/SessionList.test.tsx b/src/components/SessionList.test.tsx
--- a/src/components/SessionList.test.tsx
+++ b/src/components/SessionList.test.tsx
@@ -42,2 +42,5 @@
   expect(tree).toHaveLength(3);
-  expect(rows).toHaveLength(6);
+  expect(rows).toHaveLength(9);
+  expect(rows[3]).toHaveTextContent('Trace Root Cause');
+  expect(rows[4]).toHaveTextContent('Collect Logs');
+  expect(rows[5]).toHaveTextContent('Analyze Stack');
`,
  },
  {
    path: "src/components/Composer.test.tsx",
    additions: 3,
    deletions: 2,
    status: "modified",
    defaultExpanded: false,
    patch: `diff --git a/src/components/Composer.test.tsx b/src/components/Composer.test.tsx
--- a/src/components/Composer.test.tsx
+++ b/src/components/Composer.test.tsx
@@ -78,3 +78,4 @@
   const composer = screen.getByRole('textbox');
-  expect(composer).toHaveStyle({ height: '52px' });
-  expect(screen.getByText('Cmd+Enter to send')).toBeVisible();
+  expect(composer).toHaveStyle({ minHeight: '78px' });
+  expect(screen.getByRole('group', { name: 'Model' })).toBeVisible();
+  expect(screen.getByRole('group', { name: 'Reasoning' })).toBeVisible();
`,
  },
];

const meta = {
  title: "Showcase/AMOLED Workspace",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;

function WorkspaceShowcaseFixture() {
  const contextTabsId = "showcase-workspace-context";
  const panelState = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const [expandedSessions, setExpandedSessions] = createSignal<readonly string[]>([
    "refactor-utils",
    "investigate-bug",
    "trace-root-cause",
    "prototype-api",
    "implement-endpoints",
    "ui-polish",
    "update-tests",
  ]);
  const [draft, setDraft] = createSignal("");
  const [diffComparison, setDiffComparison] = createSignal("working");

  const toggle = (id: string) => {
    setExpandedSessions((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  return (
    <div data-platform="macos" style={{ width: "100vw", height: "100vh" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Compact Ledger Transcript"
            rightControls={
              <Show when={!panelState.mobile()}>
                <ContextTabs
                  idBase={contextTabsId}
                  onClose={() => panelState.setRightPanelOpen(false)}
                />
              </Show>
            }
            mobile={panelState.mobile()}
            leftSidebarOpen={panelState.leftSidebarOpen()}
            rightPanelOpen={panelState.rightPanelOpen()}
            rightPanelAvailable
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
                statusForSession={(id) =>
                  [
                    "refactor-utils",
                    "config-option",
                    "auth-layer",
                    "typography",
                    "update-tests",
                    "unit-tests",
                    "integrate-stripe",
                  ].includes(id)
                    ? "running"
                    : "idle"
                }
                selectedID="compact-ledger"
                expandedIDs={expandedSessions()}
                loading={false}
                canCreate
                canDelete
                deletionStatusForSession={() => "ready"}
                autoFocusClose={panelState.mobile()}
                serverName="Local server"
                serverStatus="connected"
                onSelect={() => {
                  if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
                }}
                onToggleExpanded={toggle}
                onDelete={() => undefined}
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
                title="Compact Ledger Transcript"
                transcript={
                  <TranscriptView
                    sessionID="amoled-workspace"
                    messages={transcript}
                    sessionStatus="idle"
                    pendingInteraction={
                      <article
                        class="transcript-message transcript-assistant-message transcript-pending-interaction"
                        data-message-id="workspace-question-form"
                      >
                        <QuestionForm
                          form={workspaceQuestionForm}
                          onSubmit={() => undefined}
                          onCancel={() => undefined}
                        />
                      </article>
                    }
                  />
                }
                composer={
                  <Composer
                    value={draft()}
                    disabled={false}
                    submitting={false}
                    running={false}
                    modelSelection={composerModelSelection()}
                    agentSelection={composerAgentSelection()}
                    onInput={setDraft}
                    onSubmit={() => setDraft("")}
                  />
                }
              />
            }
            context={
              <ContextPanel
                onClose={() => panelState.setRightPanelOpen(false)}
                showTabs={panelState.mobile()}
                autoFocusClose={panelState.mobile()}
                tabsIdBase={contextTabsId}
                diff={{
                  files: diff,
                  loading: false,
                  comparison: diffComparison(),
                  comparisonOptions: [
                    { value: "working", label: "Working changes" },
                    { value: "branch", label: "Changes vs main" },
                  ],
                  onComparisonChange: setDiffComparison,
                }}
              />
            }
          />
        }
      />
    </div>
  );
}

export const WorkspaceShowcase = {
  render: () => <WorkspaceShowcaseFixture />,
};
