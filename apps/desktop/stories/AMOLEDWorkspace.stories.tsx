/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { Show, For, createSignal } from "solid-js";
import { expect, screen, userEvent, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { createShellPanelState } from "../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import { ContextTitlebarRegion } from "../src/renderer/components/App/ConnectedApp/Shell/ContextTitlebarRegion.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import { SessionSidebar } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { QuestionForm } from "../src/renderer/ui/QuestionForm.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import type { SessionMessageInfo } from "@opencode/client";
import { useDialog } from "@opencode/ui/context/dialog";
import { richItems, markdownAssistant, streamingAssistant } from "./transcript-catalog-fixtures.ts";
import { GlobalFormsRegion } from "../src/renderer/components/App/ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { createFakeGlobalForms } from "./global-forms/global-form-fixtures.ts";
import { PermissionRequestCard } from "../src/renderer/ui/PermissionRequestCard.tsx";
import {
  NewSessionDialog,
  type NewSessionLocationMode,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/NewSessionDialog.tsx";
import { DeleteSessionDialog } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/DeleteSessionFlow/DeleteSessionDialog.tsx";
import {
  createSessionPrompt,
  readSessionPromptMetadata,
} from "../src/renderer/opencode/session-prompt.ts";
import { reviewPrompt } from "./transcript-catalog-fixtures.ts";
import { WorkspaceAddProject } from "./workspace-showcase/WorkspaceAddProject.tsx";
import { WorkspaceBrowser } from "./workspace-showcase/WorkspaceBrowser.tsx";
import { createWorkspacePermissions } from "./workspace-showcase/permission-fixture.ts";
import { storySession } from "./session-fixtures.ts";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";
import { previewImageBase64 } from "./image-fixtures.ts";
import { workspaceQuestionForm } from "./question-form-fixtures.ts";

const sessions = [
  storySession(
    "compact-ledger",
    "Compact Ledger Transcript with a Long-Running Read-Only Investigation",
  ),
  storySession(
    "ledger-layout",
    "Review transcript layout and preserve readable spacing in narrow workspaces",
    "compact-ledger",
  ),
  storySession("ledger-spacing", "Adjust message spacing", "compact-ledger"),
  storySession("refactor-utils", "Refactor Utils"),
  storySession("rename-helpers", "Rename Helpers", "refactor-utils"),
  storySession(
    "extract-hooks",
    "Extract shared hooks for session navigation and background turn completion",
    "refactor-utils",
  ),
  storySession("investigate-bug", "Investigate Bug"),
  storySession("reproduce-issue", "Reproduce Issue", "investigate-bug"),
  storySession("trace-root-cause", "Trace Root Cause", "investigate-bug"),
  storySession("collect-logs", "Collect Logs", "trace-root-cause"),
  storySession("analyze-stack", "Analyze Stack", "trace-root-cause"),
  storySession(
    "config-option",
    "Add configuration options for remote development server connections",
  ),
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
    file: "lazygit/config.yml",
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
    file: "nix/hosts/personal/flake.lock",
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
    file: "src/components/SessionList.test.tsx",
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
    file: "src/components/Composer.test.tsx",
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
  const dialog = useDialog();
  let nextID = 0;
  const globalForms = createFakeGlobalForms();
  const permissions = createWorkspacePermissions();
  const [sessionItems, setSessionItems] = createSignal(sessions);
  const [selectedID, setSelectedID] = createSignal("compact-ledger");
  const selectedTitle = () =>
    sessionItems().find((item) => item.id === selectedID())?.title ?? "New session";
  const [sentMessages, setSentMessages] = createSignal<
    Record<string, readonly SessionMessageInfo[]>
  >({});
  const [model, setModel] = createSignal("openai/gpt-5");
  const [variant, setVariant] = createSignal("deep");
  const [agent, setAgent] = createSignal("build");
  const [stopped, setStopped] = createSignal<readonly string[]>([]);
  const running = (id: string) =>
    [
      "refactor-utils",
      "config-option",
      "auth-layer",
      "typography",
      "update-tests",
      "unit-tests",
      "integrate-stripe",
    ].includes(id) && !stopped().includes(id);
  const [files, setFiles] = createSignal<readonly File[]>([]);
  const [reviewCount, setReviewCount] = createSignal(2);
  const [project, setProject] = createSignal("oc-ui");
  const [mode, setMode] = createSignal<NewSessionLocationMode>("worktree");
  const [projects, setProjects] = createSignal([
    { id: "oc-ui", name: "oc-ui", location: { directory: "/srv/projects/oc-ui" }, vcs: "git" },
    {
      id: "opencode",
      name: "OpenCode",
      location: { directory: "/srv/projects/opencode" },
      vcs: "git",
    },
  ]);
  const createSession = (worktree: boolean) => {
    const id = `showcase-${++nextID}`;
    setSessionItems((items) => [
      storySession(id, `${project()} · ${worktree ? "worktree" : "project folder"}`),
      ...items,
    ]);
    setSelectedID(id);
    setDraft("");
    setFiles([]);
    setReviewCount(0);
    dialog.close();
  };
  const newSession = () =>
    void dialog.show(() => (
      <NewSessionDialog
        state={{ projects: projects(), selectedProjectID: project(), mode: mode() }}
        onProjectChange={setProject}
        onModeChange={setMode}
        onAddProject={() =>
          void dialog.push(() => (
            <WorkspaceAddProject
              onAddProject={(location) => {
                const id = location.directory;
                setProjects((items) =>
                  items.some((item) => item.id === id)
                    ? items
                    : [
                        ...items,
                        {
                          id,
                          name:
                            location.directory.split("/").filter(Boolean).at(-1) ??
                            location.directory,
                          location,
                          vcs: "git",
                        },
                      ],
                );
                setProject(id);
                dialog.close();
              }}
            />
          ))
        }
        onUseProject={() => createSession(false)}
        onCreateWorktree={() => createSession(true)}
        onRetryProjects={() => undefined}
        onRetry={() => undefined}
      />
    ));
  const deleteSession = (id: string) => {
    const removed = new Set([id]);
    for (let count = -1; count !== removed.size;) {
      count = removed.size;
      for (const item of sessionItems())
        if (item.parentID && removed.has(item.parentID)) removed.add(item.id);
    }
    void dialog.show(() => (
      <DeleteSessionDialog
        title={sessionItems().find((item) => item.id === id)?.title ?? "Session"}
        descendantCount={removed.size - 1}
        deleting={false}
        onDelete={() => {
          setSessionItems((items) => items.filter((item) => !removed.has(item.id)));
          if (removed.has(selectedID())) setSelectedID(sessionItems()[0]?.id ?? "");
          dialog.close();
        }}
      />
    ));
  };
  const contextTabsId = "showcase-workspace-context";
  const panelState = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const [expandedSessions, setExpandedSessions] = createSignal<readonly string[]>([
    "compact-ledger",
    "refactor-utils",
    "investigate-bug",
    "trace-root-cause",
    "prototype-api",
    "implement-endpoints",
    "ui-polish",
    "update-tests",
  ]);
  const [questionPending, setQuestionPending] = createSignal(true);
  const [readCompleted, setReadCompleted] = createSignal(false);
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
            selectedTitle={selectedTitle()}
            globalControls={<GlobalFormsRegion controller={globalForms.controller} />}
            rightControls={
              <Show when={!panelState.mobile()}>
                <ContextTitlebarRegion
                  browserAvailable
                  view={panelState.contextView()}
                  onViewChange={panelState.setContextView}
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
                sessions={sessionItems()}

                attentionForSession={(id) =>
                  id === "extract-hooks" && !readCompleted()
                    ? "completed"
                    : id === "rename-helpers" && permissions.pending()
                      ? "permission"
                      : id === "collect-logs" || (id === "compact-ledger" && questionPending())
                        ? "question"
                        : undefined
                }
                statusForSession={(id) => (running(id) ? "running" : "idle")}
                selectedID={selectedID()}
                expandedIDs={expandedSessions()}
                loading={false}
                canCreate
                canDelete
                deletionStatusForSession={() => "ready"}
                autoFocusClose={panelState.mobile()}
                serverName="Local server"
                serverStatus="connected"
                onSelect={(id) => {
                  setSelectedID(id);
                  setDraft("");
                  setFiles([]);
                  setReviewCount(0);
                  if (id === "extract-hooks") setReadCompleted(true);
                  if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
                }}
                onToggleExpanded={toggle}
                onDelete={deleteSession}
                onCreate={newSession}
                onRetry={() => undefined}
                onHide={
                  panelState.mobile() ? () => panelState.setLeftSidebarOpen(false) : undefined
                }
                onSelectServer={() => undefined}
              />
            }
            main={
              <SessionPane
                selected={selectedID() !== ""}
                title={selectedTitle()}
                transcript={
                  <TranscriptView
                    sessionID={selectedID()}
                    messages={[
                      ...(selectedID() === "compact-ledger"
                        ? [...richItems, markdownAssistant]
                        : []),
                      ...(running(selectedID()) ? [streamingAssistant] : []),
                      ...(sentMessages()[selectedID()] ?? []),
                    ]}
                    sessionStatus={running(selectedID()) ? "running" : "idle"}
                    pendingInteraction={
                      <>
                        <Show
                          when={
                            (selectedID() === "compact-ledger" ||
                              selectedID() === "collect-logs") &&
                            questionPending()
                          }
                        >
                          <article
                            class="transcript-message transcript-assistant-message transcript-pending-interaction"
                            data-message-id="workspace-question-form"
                          >
                            <QuestionForm
                              form={workspaceQuestionForm}
                              onSubmit={() => setQuestionPending(false)}
                              onCancel={() => setQuestionPending(false)}
                            />
                          </article>
                        </Show>
                        <For
                          each={permissions
                            .requests()
                            .filter((request) => request.sessionID === selectedID())}
                        >
                          {(request) => (
                            <article
                              class="transcript-message transcript-pending-interaction"
                              data-message-id={request.id}
                            >
                              <PermissionRequestCard
                                request={request}
                                onReply={(reply) => void permissions.reply(request.id, reply)}
                              />
                            </article>
                          )}
                        </For>
                      </>
                    }
                  />
                }
                composer={
                  <Composer
                    {...composerPasteProps}
                    value={draft()}
                    disabled={false}
                    action={running(selectedID()) ? "running" : "send"}
                    files={files()}
                    onAttachFiles={(added) => setFiles((items) => [...items, ...added])}
                    onRemoveFile={(file) =>
                      setFiles((items) => items.filter((item) => item !== file))
                    }
                    review={
                      reviewCount()
                        ? { count: reviewCount(), onDiscard: () => setReviewCount(0) }
                        : undefined
                    }
                    modelSelection={composerModelSelection({
                      selectedModelID: model(),
                      selectedVariantID: variant(),
                      onSelectModel: setModel,
                      onSelectVariant: setVariant,
                    })}
                    agentSelection={composerAgentSelection({
                      selectedAgentID: agent(),
                      onSelectAgent: setAgent,
                    })}
                    onInput={setDraft}
                    onSubmit={() => {
                      const id = `message-${++nextID}`;
                      const prompt = createSessionPrompt({
                        instruction: draft(),
                        annotations: [],
                        reviewComments: reviewCount()
                          ? (readSessionPromptMetadata(reviewPrompt.metadata)?.reviewComments ?? [])
                          : [],
                      });
                      const user: SessionMessageInfo = {
                        id,
                        type: "user",
                        time: { created: nextID + 20 },
                        text: prompt.text,
                        metadata: prompt.metadata,

                        files: files().map((file) => ({
                          name: file.name,
                          mime: file.type || "application/octet-stream",
                          data: previewImageBase64,
                          source: { type: "inline" },
                        })),
                      };
                      setSentMessages((items) => ({
                        ...items,
                        [selectedID()]: [
                          ...(items[selectedID()] ?? []),
                          user,
                          {
                            id: `reply-${id}`,
                            type: "assistant",
                            time: { created: nextID + 21, completed: nextID + 22 },
                            agent: agent(),
                            model: { providerID: "openai", id: "gpt-5" },
                            finish: "stop",
                            content: [
                              {
                                type: "text",
                                text: "This is a simulated Storybook response. Your prompt was added to this session; no server request was sent.",
                              },
                            ],
                          },
                        ],
                      }));
                      setDraft("");
                      setFiles([]);
                      setReviewCount(0);
                    }}
                    onStop={() => setStopped((items) => [...items, selectedID()])}
                  />
                }
              />
            }
            context={
              <div class="workspace-context-body">
                <Show when={panelState.mobile()}>
                  <ContextTitlebarRegion
                    browserAvailable
                    view={panelState.contextView()}
                    onViewChange={panelState.setContextView}
                    onClose={() => panelState.setRightPanelOpen(false)}
                  />
                </Show>
                <Show
                  when={panelState.contextView() === "browser"}
                  fallback={
                    <ContextPanel
                      onClose={() => panelState.setRightPanelOpen(false)}
                      showTabs={false}
                      autoFocusClose={panelState.mobile()}
                      tabsIdBase={contextTabsId}
                      files={diff}
                      presentation={{
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
                >
                  <WorkspaceBrowser />
                </Show>
              </div>
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

export const DarkWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  globals: { theme: "dark" },
};

// Keep the default story untouched for visual work; exercise local callbacks here.
export const InteractiveWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Browser" }));
    await expect(canvas.getByRole("textbox", { name: "Browser address" })).toHaveValue(
      "http://localhost:3000",
    );
    await userEvent.click(canvas.getByRole("button", { name: "New browser tab" }));
    await expect(canvas.getByRole("button", { name: "Close New tab" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Diff" }));
    await userEvent.click(
      canvas.getByRole("button", { name: "Rename Helpers, Permission required" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Allow once" }));
    await expect(canvas.getByRole("button", { name: "Rename Helpers, Idle" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Refactor Utils, Running" }));
    await userEvent.click(canvas.getByRole("button", { name: "Stop" }));
    await expect(canvas.getByRole("button", { name: "Refactor Utils, Idle" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Create session" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use project folder" }));
    await expect(
      await canvas.findByRole("region", { name: "oc-ui · project folder" }),
    ).toBeInTheDocument();
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "Check this fixture");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(canvas.getByText("Check this fixture", { exact: true })).toBeInTheDocument();
    await expect(canvas.getByText(/This is a simulated Storybook response/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "oc-ui · project folder, Idle" }));
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Delete oc-ui · project folder" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete session" }));
    await canvas.findByRole("button", { name: "Create session" });
    await expect(
      canvas.queryByRole("button", { name: "oc-ui · project folder, Idle" }),
    ).not.toBeInTheDocument();
  },
};
export const NarrowWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  globals: { viewport: { value: "narrow", isRotated: false } },
};
export const MobileWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
