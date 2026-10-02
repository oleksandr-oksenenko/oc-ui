/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { Show, For, createMemo, createSignal, onCleanup } from "solid-js";
import { RegistryContext } from "@effect/atom-solid";
import { AtomRegistry } from "effect/unstable/reactivity";
import { Effect, Exit, Scope } from "effect";
import { showToast, Toast, toaster } from "@opencode/ui/toast";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { createShellPanelState } from "../src/renderer/components/App/ConnectedApp/Shell/createShellPanelState.ts";
import { SessionHeader } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionHeader.tsx";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { ContextPanel } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import { ContextTitlebarRegion } from "../src/renderer/components/App/ConnectedApp/Shell/ContextTitlebarRegion.tsx";
import type { DiffFileData } from "../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import {
  SessionSidebar,
  type SessionSidebarProps,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { QuestionForm } from "../src/renderer/ui/QuestionForm.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import type { PromptSkillAttachment, SessionInboxUser, SessionMessageInfo } from "@opencode/client";
import { useDialog } from "@opencode/ui/context/dialog";
import {
  assistant,
  richItems,
  markdownAssistant,
  streamingAssistant,
} from "./transcript-catalog-fixtures.ts";
import { GlobalFormsRegion } from "../src/renderer/components/App/ConnectedApp/GlobalForms/GlobalFormsRegion.tsx";
import { createFakeGlobalForms } from "./global-forms/global-form-fixtures.ts";
import { PermissionRequestCard } from "../src/renderer/ui/PermissionRequestCard.tsx";

import { DeleteSessionDialog } from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/DeleteSessionFlow/DeleteSessionDialog.tsx";
import { createSessionPrompt } from "../src/renderer/opencode/session-prompt.ts";
import { parseSessionCommand } from "../src/renderer/opencode/session-command.ts";
import { makeWorkspaceOwner, type WorkspaceOwner } from "../src/renderer/workspace-owner.ts";
import { createAnnotationDraftStore } from "../src/renderer/domain/annotation-drafts.ts";
import { createReviewDraftStore } from "../src/renderer/domain/review-drafts.ts";
import { annotationBlock } from "../src/renderer/components/App/ConnectedApp/Conversation/annotation-source.ts";
import { createTranscriptAnnotations } from "../src/renderer/components/App/ConnectedApp/Conversation/createTranscriptAnnotations.ts";
import { AnnotationPopover } from "../src/renderer/components/App/ConnectedApp/Conversation/AnnotationPopover.tsx";
import { PendingMessages } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/PendingMessages.tsx";
import { CodeReviewRemovalDialog } from "../src/renderer/components/App/ConnectedApp/Review/ReviewRegion/CodeReviewRemovalDialog.tsx";
import {
  WorkspaceNewSession,
  type WorkspaceNewSessionProps,
  type NewSessionDraft,
} from "./workspace-showcase/WorkspaceNewSession.tsx";
import { WorkspaceAddProject } from "./workspace-showcase/WorkspaceAddProject.tsx";
import { WorkspaceBrowser } from "./workspace-showcase/WorkspaceBrowser.tsx";
import { createWorkspacePermissions } from "./workspace-showcase/permission-fixture.ts";
import { storySession } from "./session-fixtures.ts";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";
import { previewImageBase64, previewImageFile } from "./image-fixtures.ts";
import {
  attachmentFiles,
  browserAnnotation,
  mixedAttachmentMessage,
} from "./attachment-fixtures.ts";
import { AttachmentDetailPill } from "../src/renderer/ui/AttachmentPills.tsx";
import { ImagePreview } from "../src/renderer/ui/ImagePreview.tsx";
import {
  annotationFiles,
  formatBrowserAnnotations,
  type BrowserAnnotationDraft,
} from "../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";
import { workspaceQuestionForm } from "./question-form-fixtures.ts";
import "./workspace-showcase/workspace-showcase.css";
import { WorkspaceConnection } from "./workspace-showcase/WorkspaceConnection.tsx";
import { showcaseActivityAssistant } from "./workspace-showcase/activity-fixture.ts";

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
@@ -186,7 +186,7 @@
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
  title: "Showcase/Warm Paper Workspace",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;

type WorkspaceShowcaseProps = {
  readonly initialState?: "ready" | "loading" | "error" | "empty";
  readonly initialSession?: string;
  readonly newSession?: Omit<
    WorkspaceNewSessionProps,
    "onSubmit" | "onAddProject" | "draft" | "onDraftChange"
  > & {
    readonly mode?: "local" | "worktree";
    readonly newBranch?: boolean;
    readonly nonGit?: boolean;
    readonly attachment?: boolean;
  };
};

function initialNewSessionDraft(
  options: WorkspaceShowcaseProps["newSession"] = {},
): NewSessionDraft {
  return {
    value: options.empty ? "" : "Design the new session experience",
    projectID: options.nonGit ? "notes" : "oc-ui",
    mode: options.nonGit ? "local" : (options.mode ?? "local"),
    branch: options.newBranch
      ? { kind: "new", name: "feature/new-session" }
      : { kind: "existing", name: "main" },
    files: options.attachment ? [previewImageFile()] : [],
    model: "openai/gpt-5",
    variant: "deep",
    agent: "build",
  };
}

function WorkspaceShowcaseFixture(props: WorkspaceShowcaseProps) {
  const registry = AtomRegistry.make();
  const scope = Scope.makeUnsafe();
  const effects = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  // The story owns its draft stores. Close owned work before disposing their registry.
  onCleanup(() => {
    void Effect.runPromise(Scope.close(scope, Exit.void)).then(() => registry.dispose());
  });
  return (
    <RegistryContext.Provider value={registry}>
      <WorkspaceShowcaseContent {...props} effects={effects} />
    </RegistryContext.Provider>
  );
}

function WorkspaceShowcaseContent(
  props: WorkspaceShowcaseProps & { readonly effects: WorkspaceOwner },
) {
  const dialog = useDialog();
  let nextID = 0;
  const globalForms = createFakeGlobalForms();
  const permissions = createWorkspacePermissions();
  const [sessionItems, setSessionItems] = createSignal(sessions);
  const [selectedID, setSelectedID] = createSignal(
    props.initialState === "empty" ? "" : (props.initialSession ?? "compact-ledger"),
  );
  const newSessionOptions = () => props.newSession ?? {};
  const [newSessionDraft, setNewSessionDraft] = createSignal(
    initialNewSessionDraft(props.newSession),
  );
  const draftStatus = () => newSessionOptions().status?.kind;
  const [showNewSession, setShowNewSession] = createSignal(props.newSession !== undefined);
  const [draftItems, setDraftItems] = createSignal([
    {
      id: "new-session",
      title: "Design the new session experience",
      project: "oc-ui",
      status: draftStatus(),
    },
  ]);
  const selectedSessionID = () => (showNewSession() ? undefined : selectedID());
  const selectedDraftID = () => (showNewSession() ? "new-session" : undefined);
  const [viewState, setViewState] = createSignal(props.initialState ?? "ready");
  const showContent = () => viewState() !== "loading" && viewState() !== "empty";
  const visibleSessions = () => (showContent() ? sessionItems() : []);
  const serverStatus = (): SessionSidebarProps["serverStatus"] =>
    viewState() === "error" ? "failed" : viewState() === "loading" ? "reconnecting" : "connected";
  const [selectingServer, setSelectingServer] = createSignal(false);
  const [serverName, setServerName] = createSignal("Local server");
  let toastID: ReturnType<typeof showToast> | undefined;
  onCleanup(() => {
    if (toastID !== undefined) toaster.dismiss(toastID);
  });
  const notify = (title: string, description: string) => {
    if (toastID !== undefined) toaster.dismiss(toastID);
    toastID = showToast({ title, description, persistent: true });
  };
  const selectedTitle = () =>
    showNewSession()
      ? "New session"
      : (sessionItems().find((item) => item.id === selectedID())?.title ?? "New session");
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
  const initialAttachments =
    selectedID() === "compact-ledger"
      ? { files: attachmentFiles().slice(0, 2), browser: [browserAnnotation] }
      : { files: [], browser: [] };
  const [files, setFiles] = createSignal<readonly File[]>(initialAttachments.files);
  const [browserAttachments, setBrowserAttachments] = createSignal<
    readonly BrowserAnnotationDraft[]
  >(initialAttachments.browser);
  const attachedFiles = () => [...files(), ...annotationFiles(browserAttachments())];
  const instruction = () =>
    [draft(), formatBrowserAnnotations(browserAttachments())].filter(Boolean).join("\n\n");
  const [skills, setSkills] = createSignal<readonly PromptSkillAttachment[]>([]);
  const annotations = createAnnotationDraftStore(props.effects);
  const review = createReviewDraftStore(props.effects);
  const [pending, setPending] = createSignal<readonly SessionInboxUser[]>([
    {
      id: "workspace-queued",
      sessionID: "refactor-utils",
      timeCreated: 1,
      type: "user",
      delivery: "queue",
      payload: { text: "Add a focused test for the keyboard shortcuts." },
    },
  ]);
  const createSession = (mode: "local" | "worktree") => {
    const id = `showcase-${++nextID}`;
    setSessionItems((items) => [
      storySession(id, `oc-ui · ${mode === "worktree" ? "worktree" : "project folder"}`),
      ...items,
    ]);
    setSelectedID(id);
    setShowNewSession(false);
    setDraftItems([]);
    setNewSessionDraft((current) => ({ ...current, value: "", files: [] }));
    setDraft("");
    setFiles([]);
    setBrowserAttachments([]);
    setSkills([]);
    setViewState("ready");
    notify("Session created", "This is a local Storybook session. No server request was sent.");
  };
  const newSession = () => {
    if (draftItems().length === 0) {
      setDraftItems([
        {
          id: "new-session",
          title: "New session",
          project: newSessionDraft().projectID,
          status: draftStatus(),
        },
      ]);
    }
    setShowNewSession(true);
    if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
    panelState.setRightPanelOpen(false);
  };
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
  const panelState = createShellPanelState({
    leftSidebarOpen: true,
    rightPanelOpen: !showNewSession(),
  });
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
  const showQuestion = () =>
    viewState() === "ready" &&
    (selectedID() === "compact-ledger" || selectedID() === "collect-logs") &&
    questionPending();
  const selectedPermissions = () =>
    permissions.requests().filter((request) => request.sessionID === selectedID());
  const hasInteraction = () => showQuestion() || selectedPermissions().length > 0;
  const [readCompleted, setReadCompleted] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const command = () => parseSessionCommand(draft(), ["compact"])?.name;
  const runPreviewCommand = () => {
    const name = command();
    if (!name) return false;
    notify(
      `/${name} preview`,
      "Command controls are simulated here. Review comments remain attached.",
    );
    setDraft("");
    setSkills([]);
    return true;
  };
  const [diffComparison, setDiffComparison] = createSignal<"working" | "branch">("working");
  const reviewKey = () => ({ sessionID: selectedID(), comparison: diffComparison() });
  for (const [path, line, body] of [
    ["lazygit/config.yml", 11, "Check that the renamed option is supported by the pinned version."],
    [
      "nix/hosts/personal/flake.lock",
      188,
      "Confirm this lockfile change is needed for the release.",
    ],
  ] as const) {
    const key = { sessionID: "compact-ledger", comparison: "working" as const };
    const id = review.begin(
      key,
      path,
      { start: line, end: line, side: "additions" },
      "Selected changed line",
    );
    review.updateBody(key, id, body);
    review.edit(key);
  }
  annotations.add("compact-ledger", {
    source: {
      messageID: "assistant-1",
      block: annotationBlock("content", 0, "text"),
      textDigest: "e54071c2b1050bde2a1bcfacc31401030ee0a9e4d57ddbc801fc485c42218090",
      start: 0,
      end: 53,
    },
    quote: "I reviewed the release notes and the related changes.",
    body: "Keep the summary focused on what changed.",
  });
  const messages = createMemo(() =>
    showContent()
      ? [
          ...(selectedID() === "compact-ledger"
            ? [
                ...richItems.map((item) =>
                  item.id === "assistant-1" ? showcaseActivityAssistant : item,
                ),
                markdownAssistant,
                mixedAttachmentMessage,
              ]
            : []),
          ...(selectedID() === "error-handling" ? [assistant("failed-check", "error")] : []),
          ...(running(selectedID()) ? [streamingAssistant] : []),
          ...(sentMessages()[selectedID()] ?? []),
        ]
      : [],
  );
  const annotationUI = createTranscriptAnnotations({
    sessionID: selectedID,
    messages,
    drafts: annotations,
    enabled: () => viewState() === "ready" && !running(selectedID()),
  });
  const discardReview = () => {
    const key = reviewKey();
    void dialog.show(() => (
      <CodeReviewRemovalDialog
        title="Discard code review?"
        description="These comments have not been sent yet."
        confirmLabel="Discard review"
        onConfirm={() => review.clear(key)}
      />
    ));
  };
  const queuePrompt = (delivery: SessionInboxUser["delivery"]) => {
    if (runPreviewCommand()) return;
    const prompt = createSessionPrompt({
      instruction: instruction(),
      skills: skills(),
      annotations: annotations.get(selectedID()),
      reviewComments: review.get(reviewKey()).comments,
    });
    setPending((items) => [
      ...items,
      {
        id: `pending-${++nextID}`,
        sessionID: selectedID(),
        timeCreated: nextID,
        type: "user",
        delivery,
        payload: {
          ...prompt,
          files: attachedFiles().map((file) => ({
            name: file.name,
            mime: file.type || "text/plain",
            data: previewImageBase64,
            source: { type: "inline" as const },
          })),
        },
      },
    ]);
    setDraft("");
    setFiles([]);
    setBrowserAttachments([]);
    setSkills([]);
    review.clear(reviewKey());
    annotations.clear(selectedID());
  };

  const toggle = (id: string) => {
    setExpandedSessions((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  return (
    <>
      <Show when={selectingServer()}>
        <WorkspaceConnection
          onConnect={(name) => {
            setServerName(name);
            setSelectingServer(false);
            notify("Preview connection selected", "The workspace is using local fixture data.");
          }}
        />
      </Show>
      <div data-platform="macos" class="workspace-showcase" hidden={selectingServer()}>
        <AppShell
          titlebar={
            <Titlebar
              selectedTitle={selectedTitle()}
              sidebarActions={
                <SessionHeader
                  canCreate={viewState() === "ready" || viewState() === "empty"}
                  onCreate={newSession}
                />
              }
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
                  showHeader={panelState.mobile()}
                  sidebarVisible={panelState.leftSidebarOpen()}
                  sessions={visibleSessions()}
                  drafts={{
                    drafts: draftItems(),
                    selectedID: selectedDraftID(),
                    onSelect: () => newSession(),
                    onDelete: (id) => {
                      setDraftItems((items) => items.filter((item) => item.id !== id));
                      setNewSessionDraft((current) => ({ ...current, value: "", files: [] }));
                      setShowNewSession(false);
                    },
                  }}

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
                  selectedID={selectedSessionID()}
                  expandedIDs={expandedSessions()}
                  loading={viewState() === "loading"}
                  error={
                    viewState() === "error" ? "The server connection was interrupted." : undefined
                  }
                  canCreate={viewState() === "ready" || viewState() === "empty"}
                  canDelete={viewState() === "ready"}
                  deletionStatusForSession={() => "ready"}
                  autoFocusClose={panelState.mobile()}
                  serverName={serverName()}
                  globalControls={
                    <GlobalFormsRegion
                      controller={globalForms.controller}
                      visible={panelState.leftSidebarOpen()}
                    />
                  }
                  serverStatus={serverStatus()}
                  onSelect={(id) => {
                    setShowNewSession(false);
                    setSelectedID(id);
                    setDraft("");
                    setFiles([]);
                    setBrowserAttachments([]);
                    setSkills([]);
                    if (id === "extract-hooks") setReadCompleted(true);
                    if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
                  }}
                  onToggleExpanded={toggle}
                  onDelete={deleteSession}
                  onCreate={newSession}
                  onRetry={() => setViewState("ready")}
                  onHide={
                    panelState.mobile() ? () => panelState.setLeftSidebarOpen(false) : undefined
                  }
                  onSelectServer={() => {
                    annotationUI.close();
                    setSelectingServer(true);
                  }}
                />
              }
              main={
                <Show
                  when={showNewSession()}
                  fallback={
                    <SessionPane
                      selected={selectedID() !== ""}
                      title={selectedTitle()}
                      transcript={
                        <TranscriptView
                          sessionID={selectedID()}
                          messages={messages()}
                          annotationRootRef={annotationUI.attach}
                          onOpenAnnotation={annotationUI.openSent}
                          loading={viewState() === "loading"}
                          error={
                            viewState() === "error"
                              ? "The conversation could not be refreshed."
                              : undefined
                          }
                          onRetry={() => setViewState("ready")}
                          sessionStatus={running(selectedID()) ? "running" : "idle"}
                          pendingInteraction={
                            hasInteraction() ? (
                              <>
                                <Show when={showQuestion()}>
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
                                <For each={selectedPermissions()}>
                                  {(request) => (
                                    <article
                                      class="transcript-message transcript-pending-interaction"
                                      data-message-id={request.id}
                                    >
                                      <PermissionRequestCard
                                        request={request}
                                        onReply={(reply) =>
                                          void permissions.reply(request.id, reply)
                                        }
                                      />
                                    </article>
                                  )}
                                </For>
                              </>
                            ) : undefined
                          }
                        />
                      }
                      composer={
                        <>
                          <PendingMessages
                            messages={pending().filter((item) => item.sessionID === selectedID())}
                            disabled={viewState() !== "ready"}
                            onCancel={(id) =>
                              setPending((items) => items.filter((item) => item.id !== id))
                            }
                            onSteer={(id) =>
                              setPending((items) =>
                                items.map((item) =>
                                  item.id === id ? { ...item, delivery: "steer" } : item,
                                ),
                              )
                            }
                          />
                          <Composer
                            {...composerPasteProps}
                            sessionID={selectedID()}
                            value={draft()}
                            command={command()}
                            skills={skills()}
                            catalog={{
                              commands: {
                                state: "ready",
                                items: [
                                  { name: "compact", description: "Compact the current session." },
                                ],
                              },
                              skills: {
                                state: "ready",
                                items: [
                                  {
                                    id: "review",
                                    name: "review",
                                    description: "Review changes for bugs and missing tests.",
                                  },
                                  {
                                    id: "simplify",
                                    name: "simplify",
                                    description: "Find a smaller, clearer implementation.",
                                  },
                                ],
                              },
                              onRetry: () => undefined,
                            }}
                            contextUsage={{
                              used: running(selectedID()) ? 92000 : 42000,
                              limit: 128000,
                            }}
                            disabled={viewState() !== "ready"}
                            error={
                              viewState() === "error"
                                ? "Reconnect before sending. Your draft is preserved."
                                : undefined
                            }
                            action={running(selectedID()) ? "running" : "send"}
                            attachments={{
                              count: browserAttachments().length,
                              content: (
                                <Show when={browserAttachments().length > 0}>
                                  <AttachmentDetailPill
                                    kind="browser"
                                    label={`Browser · ${browserAttachments().length}`}
                                    title="Browser annotation"
                                    removeLabel="Discard browser annotations"
                                    disabled={viewState() !== "ready"}
                                    onRemove={() => setBrowserAttachments([])}
                                  >
                                    <For each={browserAttachments()}>
                                      {(item) => (
                                        <div class="attachment-pill-comment">
                                          <p>{item.body}</p>
                                          <div class="attachment-pill-source">
                                            {item.tab.title} · {item.tab.url}
                                            <br />
                                            {item.selection.label}
                                          </div>
                                          <ImagePreview
                                            file={annotationFiles([item])[0]!}
                                            alt={item.image.name}
                                            class="attachment-pill-browser-image"
                                          />
                                        </div>
                                      )}
                                    </For>
                                  </AttachmentDetailPill>
                                </Show>
                              ),
                            }}
                            files={files()}
                            onAttachFiles={(added) => setFiles((items) => [...items, ...added])}
                            onAttachText={(text) =>
                              setFiles((items) => [
                                ...items,
                                new File([text], "pasted-text.txt", { type: "text/plain" }),
                              ])
                            }
                            onRemoveFile={(file) =>
                              setFiles((items) => items.filter((item) => item !== file))
                            }
                            review={
                              review.get(reviewKey()).comments.length
                                ? {
                                    comments: review.get(reviewKey()).comments,
                                    onDiscard: () => discardReview(),
                                  }
                                : undefined
                            }
                            annotations={
                              annotations.get(selectedID()).length
                                ? {
                                    count: annotations.get(selectedID()).length,
                                    onOpen: annotationUI.toggleDrafts,
                                    expanded: annotationUI.draftsOpen(),
                                    controls: annotationUI.popupID,
                                    onDiscard: () => annotations.clear(selectedID()),
                                  }
                                : undefined
                            }
                            modelSelection={composerModelSelection({
                              selectedModelID: model(),
                              disabled: viewState() !== "ready",
                              selectedVariantID: variant(),
                              onSelectModel: setModel,
                              onSelectVariant: setVariant,
                            })}
                            agentSelection={composerAgentSelection({
                              selectedAgentID: agent(),
                              disabled: viewState() !== "ready",
                              onSelectAgent: setAgent,
                            })}
                            onInput={(text, selectedSkills = []) => {
                              setDraft(text);
                              setSkills(selectedSkills);
                            }}
                            onQueue={() => queuePrompt("queue")}
                            onSubmit={() => {
                              if (runPreviewCommand()) return;
                              if (running(selectedID())) {
                                queuePrompt("steer");
                                return;
                              }
                              const id = `message-${++nextID}`;
                              const prompt = createSessionPrompt({
                                instruction: instruction(),
                                skills: skills(),
                                annotations: annotations.get(selectedID()),
                                reviewComments: review.get(reviewKey()).comments,
                              });
                              const user: SessionMessageInfo = {
                                id,
                                type: "user",
                                time: { created: nextID + 20 },
                                text: prompt.text,
                                metadata: prompt.metadata,

                                files: attachedFiles().map((file) => ({
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
                              setBrowserAttachments([]);
                              setSkills([]);
                              review.clear(reviewKey());
                              annotations.clear(selectedID());
                            }}
                            onStop={() => setStopped((items) => [...items, selectedID()])}
                          />
                        </>
                      }
                    />
                  }
                >
                  <WorkspaceNewSession
                    {...props.newSession}
                    draft={newSessionDraft()}
                    onDraftChange={(patch) =>
                      setNewSessionDraft((current) => ({ ...current, ...patch }))
                    }
                    onSubmit={createSession}
                    onAddProject={() =>
                      void dialog.show(() => (
                        <WorkspaceAddProject
                          onAddProject={() => {
                            dialog.close();
                            notify(
                              "Project selected",
                              "This is a Storybook preview. No server request was sent.",
                            );
                          }}
                        />
                      ))
                    }
                  />
                </Show>
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
                        files={showContent() ? diff : []}
                        review={{
                          comments: review.get(reviewKey()).comments,
                          editingCommentID: review.get(reviewKey()).editingCommentID,
                          onBeginComment: (path, selection, code) =>
                            review.begin(reviewKey(), path, selection, code),
                          onUpdateCommentBody: (id, body) =>
                            review.updateBody(reviewKey(), id, body),
                          onEditComment: (id) => review.edit(reviewKey(), id),
                          onFinishComment: (id) => {
                            if (
                              !review
                                .get(reviewKey())
                                .comments.find((item) => item.id === id)
                                ?.body.trim()
                            )
                              review.remove(reviewKey(), id);
                            else review.edit(reviewKey());
                          },
                          onRemoveComment: (id) => review.remove(reviewKey(), id),
                        }}
                        presentation={{
                          loading: viewState() === "loading",
                          error:
                            viewState() === "error" ? "Changes may be out of date." : undefined,
                          stale: viewState() === "error",
                          onRetry: () => setViewState("ready"),
                          comparison: diffComparison(),
                          comparisonOptions: [
                            { value: "working", label: "Working changes" },
                            { value: "branch", label: "Changes vs main" },
                          ],
                          onComparisonChange: (value) =>
                            setDiffComparison(value === "branch" ? "branch" : "working"),
                        }}
                      />
                    }
                  >
                    <WorkspaceBrowser
                      onAddAnnotations={(added) =>
                        setBrowserAttachments((items) => [...items, ...added])
                      }
                    />
                  </Show>
                </div>
              }
            />
          }
        />
      </div>
      <AnnotationPopover controller={annotationUI} />
      <Toast.Region style={{ "z-index": 40 }} />
    </>
  );
}

export const WorkspaceShowcase = {
  render: () => <WorkspaceShowcaseFixture />,
};

export const WorkspaceRequests = {
  render: () => <WorkspaceShowcaseFixture />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const sidebar = canvas.getByRole("complementary", { name: "Sessions" });
    const requests = within(sidebar).getByRole("button", { name: "Review 3 requests" });
    await expect(requests.querySelector(".global-forms-region-count")).toHaveTextContent("3");
    await expect(canvasElement.querySelector(".titlebar-global-controls button")).toBeNull();

    await userEvent.click(requests);
    const dialog = await screen.findByRole("dialog", { name: /^Review requests/ });
    await expect(dialog).toHaveTextContent("/srv/workspaces/oc-ui");
    await expect(dialog).toHaveTextContent("workspace-demo");

    for (const remaining of [2, 1, 0]) {
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(async () => {
        const launcher = sidebar.querySelector(".global-forms-region-button");
        if (remaining === 0) await expect(launcher).toBeNull();
        else
          await expect(launcher?.querySelector(".global-forms-region-count")).toHaveTextContent(
            String(remaining),
          );
      });
    }
    await expect(dialog).toHaveTextContent("No requests");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep pending" }));
    await waitFor(() =>
      expect(
        within(sidebar).getByRole("button", { name: /Select server, Local server/ }),
      ).toHaveFocus(),
    );
  },
};

export const DarkWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  globals: { theme: "dark" },
};

export const QueuedWorkspace = {
  render: () => <WorkspaceShowcaseFixture initialSession="refactor-utils" />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Steer now" }));
    await expect(canvas.getByText("Steering · waiting for next step")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Cancel message: Add a focused test for the keyboard shortcuts.",
      }),
    );
    await expect(canvas.queryByRole("region", { name: "Pending messages" })).toBeNull();
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Prompt" }),
      "Check keyboard focus next.",
    );
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect(canvas.getByText("Queued")).toBeVisible();
    await expect(canvas.getByText("Check keyboard focus next.")).toBeVisible();
  },
};

export const FailedToolWorkspace = {
  render: () => <WorkspaceShowcaseFixture initialSession="error-handling" />,
};

export const LoadingWorkspace = {
  render: () => <WorkspaceShowcaseFixture initialState="loading" />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Loading transcript")).toBeVisible();
    await expect(canvas.getByText("Loading sessions")).toBeVisible();
    await expect(canvas.getByText("Loading diff")).toBeVisible();
    await expect(canvasElement.querySelector(".transcript-document")).toBeNull();
  },
};

export const ErrorRecoveryWorkspace = {
  render: () => <WorkspaceShowcaseFixture initialState="error" />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.click(
      within(canvas.getByRole("complementary", { name: "Sessions" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await expect(canvas.getByRole("button", { name: "Send" })).toBeEnabled();
    await expect(canvas.queryByText("The server connection was interrupted.")).toBeNull();
  },
};

export const EmptyWorkspace = {
  render: () => <WorkspaceShowcaseFixture initialState="empty" />,
};

export const InteractiveReview = {
  render: () => <WorkspaceShowcaseFixture />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const composer = within(canvas.getByRole("form", { name: "Message composer" }));
    await expect(canvas.getByRole("img", { name: /Context 33% used/ })).toBeVisible();
    await userEvent.click(composer.getByRole("button", { name: "Review · 2" }));
    const reviewDetails = await screen.findByRole("dialog", { name: "Review comments" });
    await expect(
      within(reviewDetails).getByText(
        "Check that the renamed option is supported by the pinned version.",
      ),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(composer.getByRole("button", { name: "Annotations · 1" }));
    const popover = await screen.findByRole("dialog", { name: "Transcript annotations" });
    await userEvent.click(within(popover).getByRole("button", { name: "Edit comment" }));
    await userEvent.type(
      within(popover).getByRole("textbox", { name: "Annotation comment" }),
      " Include the result.",
    );
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Discard 2 code review comments" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep" }));
    await expect(composer.getByText("Review · 2")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const comment = await canvas.findByRole("button", {
      name: "Check that the renamed option is supported by the pinned version.",
    });
    await userEvent.click(comment);
    const editor = await canvas.findByRole("textbox", { name: "Comment on lazygit/config.yml" });
    await userEvent.type(editor, " Check the migration guide.");
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("button", { name: /Check the migration guide/ })).toBeVisible();
    const removeComment = canvasElement.querySelector<HTMLElement>(
      '[data-comment-id="review-comment-1"] [aria-label="Delete review comment"]',
    );
    if (!removeComment) throw new Error("Review comment delete button was not rendered");
    await userEvent.click(removeComment);
    await expect(canvas.queryByRole("button", { name: /Check the migration guide/ })).toBeNull();
    await expect(
      canvas.getByRole("button", { name: /Confirm this lockfile change/ }),
    ).toBeVisible();
    await expect(canvas.getByText("Review · 1")).toBeVisible();
    await expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "Check this using /rev");
    await expect(canvas.getByText("/review", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
  },
};

// Keep the default story untouched for visual work; exercise local callbacks here.
export const InteractiveWorkspace = {
  render: () => <WorkspaceShowcaseFixture />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const composer = within(canvas.getByRole("form", { name: "Message composer" }));
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Keep this draft while browsing");
    await userEvent.click(canvas.getByRole("button", { name: "Browser" }));
    await expect(canvas.getByRole("textbox", { name: "Browser address" })).toHaveValue(
      "http://localhost:3000",
    );
    await userEvent.click(canvas.getByRole("button", { name: "New browser tab" }));
    await expect(canvas.getByRole("button", { name: "Close New tab" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Annotate" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Annotation 1 comment" }),
      "Keep the title readable.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Add to composer" }));
    await userEvent.click(canvas.getByRole("button", { name: "Browser · 2" }));
    const browserNotes = await screen.findByRole("dialog", { name: "Browser annotation" });
    await expect(within(browserNotes).getByText("Keep the title readable.")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(prompt).toHaveTextContent("Keep this draft while browsing");
    await userEvent.click(canvas.getByRole("button", { name: "Discard browser annotations" }));
    await expect(canvas.queryByRole("button", { name: "Browser · 2" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Remove release-notes.md" }));
    await expect(composer.queryByText("release-notes.md")).toBeNull();
    await expect(prompt).toHaveTextContent("Keep this draft while browsing");
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
    await userEvent.click(await canvas.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Session created", { exact: true })).toBeVisible());
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Select server, Local server, Connected" }),
    );
    await expect(canvas.getByRole("heading", { name: "Connect to OpenCode" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Start built-in server" }));
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toBeVisible();
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

export const NewSession = { render: () => <WorkspaceShowcaseFixture newSession={{}} /> };
export const NewSessionInteractions = {
  render: () => <WorkspaceShowcaseFixture newSession={{}} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.click(prompt);
    await userEvent.type(prompt, " with saved edits");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Pasted notes ".repeat(1500));
    prompt.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
    await expect(canvas.getByText("pasted-text.txt")).toBeVisible();
    await expect(prompt).toHaveTextContent("with saved edits");
    await userEvent.click(canvas.getByRole("button", { name: "Project: oc-ui" }));
    await userEvent.click(await screen.findByRole("button", { name: /scout/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Branch: main" }));
    await userEvent.click(await screen.findByRole("button", { name: "Create new branch…" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "New branch name" }),
      "feature/design",
    );
    await expect(canvas.getByText("From main")).toBeVisible();
    const showSessions = canvas.queryByRole("button", { name: "Show sessions" });
    if (showSessions) await userEvent.click(showSessions);
    await userEvent.click(canvas.getByRole("button", { name: /^Refactor Utils,/ }));
    await expect(canvas.getByRole("region", { name: "Refactor Utils" })).toBeVisible();
    const reopenSessions = canvas.queryByRole("button", { name: "Show sessions" });
    if (reopenSessions) await userEvent.click(reopenSessions);
    await userEvent.click(
      canvas.getByRole("button", { name: "Design the new session experience" }),
    );
    await expect(canvas.getByRole("button", { name: "Project: scout" })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "New branch name" })).toHaveValue(
      "feature/design",
    );
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toHaveTextContent(
      "with saved edits",
    );
    await expect(canvas.getByText("pasted-text.txt")).toBeVisible();
  },
};
export const NewSessionWorktree = {
  render: () => <WorkspaceShowcaseFixture newSession={{ mode: "worktree" }} />,
};
export const NewSessionBranch = {
  render: () => <WorkspaceShowcaseFixture newSession={{ newBranch: true }} />,
};
export const NewSessionPreparing = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Project: oc-ui" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    const showSessions = canvas.queryByRole("button", { name: "Show sessions" });
    if (showSessions) await userEvent.click(showSessions);
    await userEvent.click(canvas.getByRole("button", { name: /^Refactor Utils,/ }));
    await expect(canvas.getByRole("region", { name: "Refactor Utils" })).toBeVisible();
    const reopenSessions = canvas.queryByRole("button", { name: "Show sessions" });
    if (reopenSessions) await userEvent.click(reopenSessions);
    await userEvent.click(
      canvas.getByRole("button", { name: "Design the new session experience" }),
    );
    await expect(canvas.getByRole("button", { name: "Project: oc-ui" })).toBeDisabled();
  },
  render: () => (
    <WorkspaceShowcaseFixture
      newSession={{
        mode: "worktree",
        status: {
          kind: "preparing",
          message: "Preparing worktree…",
        },
      }}
    />
  ),
};
export const NewSessionFailed = {
  render: () => (
    <WorkspaceShowcaseFixture
      newSession={{
        status: {
          kind: "error",
          message:
            "Worktree creation failed. Your draft is saved. Any created worktree has been left on the server.",
        },
      }}
    />
  ),
};
export const NewSessionUnavailableProject = {
  render: () => {
    const [recovered, setRecovered] = createSignal(false);
    return (
      <WorkspaceShowcaseFixture
        newSession={{
          projects: [
            {
              id: "old-project",
              label: "old-project",
              detail: "/Users/alex/code/old-project",
              disabled: !recovered(),
            },
            {
              id: "other-unavailable",
              label: "other-unavailable",
              detail: "/Users/alex/code/other-unavailable",
              disabled: !recovered(),
            },
            { id: "oc-ui", label: "oc-ui", detail: "/Users/alex/code/oc-ui" },
            { id: "scout", label: "scout", detail: "/Users/alex/code/scout" },
          ],
          onRetryProjects: () => setRecovered(true),
        }}
      />
    );
  },
};
export const NewSessionUnavailableProjectInteractions = {
  ...NewSessionUnavailableProject,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Project: oc-ui" });
    await expect(canvas.queryByRole("alert")).toBeNull();
    await userEvent.click(trigger);
    const unavailable = await screen.findByRole("button", { name: /old-project.*Unavailable/ });
    await expect(unavailable).toBeDisabled();
    const projectList = unavailable.closest('[data-component="list"]');
    const active = () => projectList?.querySelector('[data-active="true"]');
    await waitFor(() => expect(active()).toHaveTextContent("oc-ui"));
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(active()).toHaveTextContent("scout"));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(active()).toHaveTextContent("oc-ui"));
    await userEvent.click(unavailable);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByPlaceholderText("Search project"), "old-project");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("button", { name: /scout/ }));
    await expect(canvas.getByRole("button", { name: "Project: scout" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Project: scout" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry unavailable projects" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Project: scout" }));
    const restored = await screen.findByRole("button", { name: /old-project/ });
    await expect(restored).toBeEnabled();
    await expect(screen.queryByRole("button", { name: "Retry unavailable projects" })).toBeNull();
    await userEvent.click(restored);
    await expect(canvas.getByRole("button", { name: "Project: old-project" })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toHaveTextContent(
      "Design the new session experience",
    );
  },
};
export const NewSessionUnavailableProjectMobile = {
  ...NewSessionUnavailableProject,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const NewSessionInterrupted = {
  render: () => (
    <WorkspaceShowcaseFixture
      newSession={{
        status: {
          kind: "interrupted",
          message: "Setup was interrupted. Nothing will be sent automatically.",
        },
      }}
    />
  ),
};
export const NewSessionAttachment = {
  render: () => <WorkspaceShowcaseFixture newSession={{ attachment: true }} />,
};
export const NewSessionNoProjects = {
  render: () => <WorkspaceShowcaseFixture newSession={{ empty: true }} />,
};
export const NewSessionLoading = {
  render: () => <WorkspaceShowcaseFixture newSession={{ loading: true }} />,
};
export const NewSessionNonGit = {
  render: () => <WorkspaceShowcaseFixture newSession={{ mode: "worktree" }} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Project: oc-ui" }));
    await userEvent.click(await screen.findByRole("button", { name: /Notes/ }));
    await expect(canvas.queryByRole("button", { name: /^Location:/ })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /^Branch:/ })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Project: Notes" }));
    await userEvent.click(await screen.findByRole("button", { name: /oc-ui/ }));
    await expect(canvas.getByRole("button", { name: "Location: Local" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Project: oc-ui" }));
    await userEvent.click(await screen.findByRole("button", { name: /Notes/ }));
  },
};
export const NewSessionMobile = {
  render: () => <WorkspaceShowcaseFixture newSession={{}} />,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const NewSessionDark = {
  render: () => <WorkspaceShowcaseFixture newSession={{}} />,
  globals: { theme: "dark" },
};
