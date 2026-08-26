import { createSignal } from "solid-js";
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
import {
  SessionSidebar,
  type SessionNode,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";
import { SessionHeader } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar/SessionHeader.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import type { TranscriptMessage } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/transcript-types.ts";

const sessions: readonly SessionNode[] = [
  {
    id: "compact-ledger",
    title: "Compact Ledger Transcript",
    status: "running",
  },
  {
    id: "refactor-utils",
    title: "Refactor Utils",
    status: "running",
    children: [
      { id: "rename-helpers", title: "Rename Helpers", status: "idle", needsInput: true },
      { id: "extract-hooks", title: "Extract Hooks", status: "idle", needsInput: true },
    ],
  },
  {
    id: "investigate-bug",
    title: "Investigate Bug",
    status: "idle",
    needsInput: true,
    children: [
      { id: "reproduce-issue", title: "Reproduce Issue", status: "idle" },
      {
        id: "trace-root-cause",
        title: "Trace Root Cause",
        status: "idle",
        needsInput: true,
        children: [
          { id: "collect-logs", title: "Collect Logs", status: "idle", needsInput: true },
          { id: "analyze-stack", title: "Analyze Stack", status: "idle", needsInput: true },
        ],
      },
    ],
  },
  { id: "config-option", title: "Add Config Option", status: "running", children: [] },
  {
    id: "prototype-api",
    title: "Prototype API",
    status: "idle",
    needsInput: true,
    children: [
      { id: "design-schema", title: "Design Schema", status: "idle", needsInput: true },
      {
        id: "implement-endpoints",
        title: "Implement Endpoints",
        status: "idle",
        needsInput: true,
        children: [
          { id: "auth-layer", title: "Auth Layer", status: "running" },
          { id: "error-handling", title: "Error Handling", status: "idle", needsInput: true },
        ],
      },
    ],
  },
  {
    id: "ui-polish",
    title: "UI Polish",
    status: "idle",
    needsInput: true,
    children: [
      { id: "layout-updates", title: "Layout Updates", status: "idle", needsInput: true },
      { id: "typography", title: "Typography", status: "running" },
      { id: "spacing-density", title: "Spacing & Density", status: "idle", needsInput: true },
    ],
  },
  { id: "improve-docs", title: "Improve Docs", status: "idle", needsInput: true },
  {
    id: "update-tests",
    title: "Update Tests",
    status: "running",
    children: [
      { id: "unit-tests", title: "Unit Tests", status: "running" },
      { id: "integration-tests", title: "Integration Tests", status: "idle", needsInput: true },
    ],
  },
  { id: "fix-login", title: "Fix Login Flow", status: "idle", needsInput: true, children: [] },
  { id: "integrate-stripe", title: "Integrate Stripe", status: "running", children: [] },
  { id: "optimize-query", title: "Optimize Query", status: "idle", needsInput: true, children: [] },
  { id: "security-audit", title: "Security Audit", status: "idle", needsInput: true, children: [] },
];

const transcript: readonly TranscriptMessage[] = [
  {
    kind: "user",
    id: "user-1",
    text: "Can you summarize the recent changes in this project?",
  },
  {
    kind: "assistant",
    id: "assistant-1",
    state: "complete",
    blocks: [
      { kind: "heading", level: 2, content: "UI Layout Updates" },
      {
        kind: "paragraph",
        content:
          "We reduced vertical density, standardized spacing, and removed extra chrome. Session rows are tighter, the composer has a more comfortable writing area, and the layout fills the window efficiently.",
      },
      {
        kind: "list",
        items: [
          "Sidebar rows use 24px height with 2px selection rule and tiny running indicators.",
          "Main transcript uses an 888px content measure with 12px padding.",
          "Composer uses a 78px default height with room to draft.",
        ],
      },
      { kind: "heading", level: 3, content: "Key Measurements" },
      {
        kind: "list",
        ordered: true,
        items: ["Sidebar width: resizable.", "Row height: 24px.", "Composer height: 78px."],
      },
      {
        kind: "quote",
        content: "These values reflect the current implementation.",
      },
      {
        kind: "paragraph",
        content: [
          "See the ",
          { kind: "link", text: "design notes", href: "https://example.com/design-notes" },
          " for spacing and typography details.",
        ],
      },
      {
        kind: "reasoning",
        label: "Reasoning summary",
        duration: "11s",
        summary: "Reviewed layout metrics, compared before/after, and validated spacing tokens.",
        defaultOpen: true,
      },
      {
        kind: "tool",
        toolKind: "read",
        name: "Read file",
        target: "src/layout/App.tsx",
        status: "done",
      },
      {
        kind: "tool",
        toolKind: "search",
        name: "Searched code",
        target: "layout density",
        detail: "14 matches",
        status: "done",
      },
      {
        kind: "tool",
        toolKind: "command",
        name: "Ran command",
        target: "pnpm test",
        status: "done",
        output:
          "PASS: src/layout/App.test.tsx\nPASS: src/components/SessionList.test.tsx\nPASS: src/components/Composer.test.tsx\nTest Suites: 3 passed, 3 total\nTests:       28 passed, 28 total\nTime:        1.42 s",
        defaultExpanded: true,
      },
    ],
  },
  {
    kind: "user",
    id: "user-2",
    text: "Any follow-ups or risks I should be aware of?",
  },
  {
    kind: "assistant",
    id: "assistant-2",
    state: "complete",
    blocks: [
      {
        kind: "paragraph",
        content:
          "A few follow-ups remain. The main risk is over-compression, which could hurt scanability on large displays.",
      },
      {
        kind: "list",
        items: [
          "Follow-up: validate with users on 1440p and 4K monitors.",
          "Risk: too little spacing may reduce readability; monitor feedback.",
          "Next: finalize color tokens and ensure sufficient contrast.",
        ],
      },
    ],
  },
];

const diff: readonly DiffFileData[] = [
  {
    path: "lazygit/config.yml",
    additions: 2,
    deletions: 2,
    defaultExpanded: true,
    lines: [
      { kind: "context", oldLine: 8, newLine: 8, content: "    reverse: true" },
      { kind: "context", oldLine: 9, newLine: 9, content: "    notARepo: 'skip'" },
      { kind: "context", oldLine: 10, newLine: 10, content: "  git:" },
      { kind: "deletion", oldLine: 11, content: "    pagers:" },
      { kind: "addition", newLine: 11, content: "    diffRenderers:" },
      { kind: "context", oldLine: 12, newLine: 12, content: "      colorArg: always" },
      {
        kind: "deletion",
        oldLine: 13,
        content: "      pager: '~/.config/git/delta-theme --paging=never'",
      },
      {
        kind: "addition",
        newLine: 13,
        content: "      command: '~/.config/git/delta-theme --paging=never'",
      },
    ],
  },
  {
    path: "nix/hosts/personal/flake.lock",
    additions: 39,
    deletions: 39,
    defaultExpanded: true,
    lines: [
      { kind: "context", oldLine: 186, newLine: 186, content: '      "locked": {' },
      { kind: "deletion", oldLine: 187, content: '        "lastModified": 1785627969,' },
      {
        kind: "deletion",
        oldLine: 188,
        content: '        "narHash": "sha256-4doxXwMulePeqvVn...",',
      },
      { kind: "addition", newLine: 187, content: '        "lastModified": 1787559586,' },
      { kind: "addition", newLine: 188, content: '        "narHash": "sha256-onuMeLWoYp7...",' },
      { kind: "context", oldLine: 189, newLine: 189, content: '        "owner": "hercules-ci",' },
      { kind: "context", oldLine: 190, newLine: 190, content: '        "repo": "flake-parts",' },
      { kind: "deletion", oldLine: 191, content: '        "rev": "420b74bd94355fdf..."' },
      { kind: "addition", newLine: 191, content: '        "rev": "90d87a72c2374f89..."' },
      { kind: "context", oldLine: 192, newLine: 192, content: '        "type": "github"' },
      { kind: "context", oldLine: 193, newLine: 193, content: "      }," },
      { kind: "context", oldLine: 194, newLine: 194, content: '      "original": {' },
      { kind: "context", oldLine: 298, newLine: 298, content: '      "locked": {' },
      { kind: "deletion", oldLine: 299, content: '        "lastModified": 1786381233,' },
      { kind: "deletion", oldLine: 300, content: '        "narHash": "sha256-T0OoLT...",' },
      { kind: "addition", newLine: 299, content: '        "lastModified": 1786983494,' },
      { kind: "addition", newLine: 300, content: '        "narHash": "sha256-n2QYWf...",' },
      { kind: "context", oldLine: 301, newLine: 301, content: '        "owner": "nix-community",' },
      { kind: "context", oldLine: 302, newLine: 302, content: '        "repo": "home-manager",' },
      { kind: "deletion", oldLine: 303, content: '        "rev": "7834e825886e0eca..."' },
      { kind: "addition", newLine: 303, content: '        "rev": "ec161155d76f7ecc..."' },
    ],
  },
  {
    path: "src/components/SessionList.test.tsx",
    additions: 4,
    deletions: 1,
    defaultExpanded: false,
    lines: [],
  },
  {
    path: "src/components/Composer.test.tsx",
    additions: 0,
    deletions: 0,
    defaultExpanded: false,
    lines: [],
  },
];

const files: readonly FileTreeNode[] = [
  {
    id: "src",
    name: "src",
    kind: "directory",
    children: [
      {
        id: "renderer",
        name: "renderer",
        kind: "directory",
        children: [
          { id: "connected", name: "ConnectedApp.tsx", kind: "file", status: "modified" },
          { id: "styles", name: "styles.css", kind: "file", status: "modified" },
        ],
      },
      { id: "main", name: "main.ts", kind: "file" },
    ],
  },
  { id: "docs", name: "component-inventory.md", kind: "file", status: "added" },
];

const meta = {
  title: "Showcase/AMOLED Workspace",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;

function WorkspaceShowcaseFixture() {
  const panelState = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const [activeTab, setActiveTab] = createSignal<ContextPanelTab>("diff");
  const [expandedSessions, setExpandedSessions] = createSignal<readonly string[]>([
    "refactor-utils",
    "investigate-bug",
    "trace-root-cause",
    "prototype-api",
    "implement-endpoints",
    "ui-polish",
    "update-tests",
  ]);
  const [expandedFiles, setExpandedFiles] = createSignal<readonly string[]>(["src", "renderer"]);
  const [draft, setDraft] = createSignal("");
  const [model, setModel] = createSignal("gpt-5.6-sol");
  const [reasoning, setReasoning] = createSignal("medium");
  const [diffScope, setDiffScope] = createSignal("all");

  const toggle = (id: string) => {
    setExpandedSessions((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };
  const toggleFile = (id: string) => {
    setExpandedFiles((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div data-platform="macos" style={{ width: "100vw", height: "100vh" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Compact Ledger Transcript"
            leftControls={
              <SessionHeader
                canCreate
                creating={false}
                onCreate={() => undefined}
                onHide={() => panelState.setLeftSidebarOpen(false)}
              />
            }
            rightControls={
              <ContextTabs
                activeTab={activeTab()}
                onTabChange={setActiveTab}
                onClose={() => panelState.setRightPanelOpen(false)}
              />
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
                nodes={sessions}
                selectedID="compact-ledger"
                expandedIDs={expandedSessions()}
                loading={false}
                canCreate
                creating={false}
                showHeader={panelState.mobile()}
                autoFocusClose={panelState.mobile()}
                serverName="Local server"
                serverStatus="connected"
                onSelect={() => {
                  if (panelState.mobile()) panelState.setLeftSidebarOpen(false);
                }}
                onToggleExpanded={toggle}
                onCreate={() => undefined}
                onRetry={() => undefined}
                onHide={() => panelState.setLeftSidebarOpen(false)}
                onSelectServer={() => undefined}
              />
            }
            main={
              <SessionPane
                selected
                title="Compact Ledger Transcript"
                transcript={
                  <TranscriptView
                    items={transcript}
                    working
                    workingLabel="Generating visual regression report…"
                  />
                }
                composer={
                  <Composer
                    value={draft()}
                    disabled={false}
                    submitting={false}
                    running={false}
                    model={{
                      label: "Model",
                      value: model(),
                      options: [
                        { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
                        { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
                      ],
                      onChange: setModel,
                    }}
                    reasoning={{
                      label: "Reasoning",
                      value: reasoning(),
                      options: [
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                      ],
                      onChange: setReasoning,
                    }}
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
                diff={{
                  files: diff,
                  loading: false,
                  scope: diffScope(),
                  scopeOptions: [{ value: "all", label: "All changes" }],
                  onScopeChange: setDiffScope,
                }}
                files={{
                  nodes: files,
                  loading: false,
                  expandedIDs: expandedFiles(),
                  onToggleExpanded: toggleFile,
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
