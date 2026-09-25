/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable failure output needs keyboard access. */

import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import { TextInput } from "@opencode/ui/text-input";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

import { ChangesRegion } from "../../src/renderer/components/App/ConnectedApp/Changes/ChangesRegion.tsx";
import { ContextPanel } from "../../src/renderer/components/App/ConnectedApp/Changes/ContextPanel.tsx";
import type { DiffFileData } from "../../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView.tsx";
import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionSidebar } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { SessionHeader } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionHeader.tsx";
import { SessionTree } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionTree.tsx";
import { AppShell } from "../../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { PermissionRequestCard } from "../../src/renderer/ui/PermissionRequestCard.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";

import {
  labActivity,
  labDiffFiles,
  labFlakyPermission,
  labInstruction,
  labNow,
  labPermission,
  labProseAfter,
  labProseBefore,
  labRuns,
  labSessions,
  labStateSummary,
  type LabActivityItem,
  type LabRun,
} from "./lab-fixtures.ts";

import "./ScenarioLab.css";

const noop = () => undefined;

const labDiffAdded = labDiffFiles.reduce((total, file) => total + file.additions, 0);
const labDiffRemoved = labDiffFiles.reduce((total, file) => total + file.deletions, 0);

function LabSidebar(props: { readonly selectedID: string }) {
  return (
    <SessionSidebar
      sessions={labSessions}
      now={labNow + 60 * 1000}
      statusForSession={() => "idle"}
      attentionForSession={(id) =>
        id === "audit" || id === "flaky"
          ? "permission"
          : id === "worktree"
            ? "completed"
            : undefined
      }
      selectedID={props.selectedID}
      expandedIDs={["audit", "worktree"]}
      loading={false}
      canCreate
      canDelete
      deletionStatusForSession={() => "ready"}
      serverName="oc-ui · local"
      serverStatus="connected"
      onSelect={noop}
      onToggleExpanded={noop}
      onDelete={noop}
      onCreate={noop}
      onRetry={noop}
      onSelectServer={noop}
    />
  );
}

const needsYou = (id: string) => id === "audit" || id === "flaky" || id === "worktree";

/* Prototype: filter the session list by sessions that need you — blocking
   requests and unread completions — instead of a queue page or a titlebar
   counter. Sessions never reorder; filtering is the only change. */
function LabAttentionSidebar() {
  const [mode, setMode] = createSignal<"all" | "attention">("attention");
  const attentionSessions = labSessions.filter((session) => needsYou(session.id));
  const sessions = createMemo(() => (mode() === "all" ? labSessions : attentionSessions));
  return (
    <aside class="shell-session-sidebar" aria-label="Sessions">
      <SessionHeader canCreate autoFocusClose={false} onCreate={noop} />
      <div class="shell-sidebar-filter">
        <TextInput
          class="shell-session-filter"
          appearance="large"
          value=""
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          leadingIcon={<Icon name="magnifying-glass" size="small" aria-hidden="true" />}
          showClearButton={false}
          onInput={noop}
        />
        <div class="lab-attention-filter" role="group" aria-label="Session filter">
          <button
            type="button"
            class="lab-attention-filter-button"
            aria-pressed={mode() === "all"}
            onClick={() => setMode("all")}
          >
            All
          </button>
          <button
            type="button"
            class="lab-attention-filter-button"
            aria-pressed={mode() === "attention"}
            onClick={() => setMode("attention")}
          >
            Needs you
            <span class="lab-attention-filter-count">{attentionSessions.length}</span>
          </button>
        </div>
      </div>
      <SessionTree
        attentionForSession={(id) =>
          id === "audit" || id === "flaky"
            ? "permission"
            : id === "worktree"
              ? "completed"
              : undefined
        }
        sessions={sessions()}
        now={labNow + 60 * 1000}
        statusForSession={() => "idle"}
        selectedID="audit"
        expandedIDs={["audit", "worktree"]}
        canDelete
        deletionStatusForSession={() => "ready"}
        onSelect={noop}
        onToggleExpanded={noop}
        onDelete={noop}
      />
    </aside>
  );
}

function LabTitlebar(props: {
  readonly title: string;
  readonly rightPanelOpen: boolean;
  readonly rightControls?: JSX.Element;
}) {
  return (
    <Titlebar
      selectedTitle={props.title}
      leftSidebarOpen
      rightPanelOpen={props.rightPanelOpen}
      rightPanelAvailable={props.rightPanelOpen}
      rightControls={props.rightControls}
      onToggleLeftSidebar={noop}
      onToggleRightPanel={noop}
    />
  );
}

/* The panel-level expand control lives where the panel's other controls live:
   next to the context tabs, like the panel toggles in the titlebar. */
function LabContextActions(props: { readonly onExpand: () => void }) {
  return (
    <div class="context-tabs">
      <span class="context-tab-label">Diff</span>
      <div class="lab-context-actions">
        <IconButton
          class="context-panel-close"
          size="normal"
          variant="ghost"
          icon={<Icon name="layout-right-full" size="small" aria-hidden="true" />}
          aria-label="Expand changes to full width"
          title="Expand changes to full width"
          onClick={props.onExpand}
        />
        <IconButton
          class="context-panel-close"
          size="normal"
          variant="ghost"
          icon={<Icon name="layout-right-partial" size="small" aria-hidden="true" />}
          aria-label="Hide context panel"
          title="Hide context panel"
          onClick={noop}
        />
      </div>
    </div>
  );
}

function LabComposer(props: { readonly action: "send" | "running" }) {
  return (
    <Composer
      value=""
      action={props.action}
      disabled={false}
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection()}
      onInput={noop}
      onAttachText={noop}
      onSubmit={noop}
      onStop={noop}
    />
  );
}

function activityIcon(name: string): "open-file" | "magnifying-glass" | "pencil-line" | "terminal" {
  if (name.includes("read")) return "open-file";
  if (name.includes("grep") || name.includes("search")) return "magnifying-glass";
  if (name.includes("apply_patch") || name.includes("edit")) return "pencil-line";
  return "terminal";
}

function activityStatusLabel(item: LabActivityItem): string {
  if (item.status === "failed") return "failed";
  if (item.status === "running") return "running";
  return "completed";
}

function LabActivityRow(props: { readonly item: LabActivityItem }) {
  if (props.item.kind === "reasoning") {
    return (
      <li class="lab-activity-row" data-kind="reasoning">
        <span class="lab-activity-icon">
          <Icon name="brain" size="small" aria-hidden="true" />
        </span>
        <span class="lab-activity-reasoning">
          <span class="sr-only">Reasoning: </span>
          {props.item.parameter}
        </span>
      </li>
    );
  }
  return (
    <li class="lab-activity-item">
      <div class="lab-activity-row">
        <span class="lab-activity-icon">
          <Icon name={activityIcon(props.item.name)} size="small" aria-hidden="true" />
        </span>
        <span class="lab-activity-name">{props.item.name}</span>
        <Show when={props.item.parameter}>
          {(parameter) => <span class="lab-activity-parameter">{parameter()}</span>}
        </Show>
        <span class="lab-activity-status" data-status={props.item.status}>
          <Show
            when={props.item.status === "running"}
            fallback={
              <Icon
                name={props.item.status === "failed" ? "warning" : "check"}
                size="small"
                aria-hidden="true"
              />
            }
          >
            <Loader width={12} height={12} aria-hidden="true" />
          </Show>
          <span class="sr-only">{activityStatusLabel(props.item)}</span>
        </span>
      </div>
      <Show when={props.item.output}>
        {(output) => (
          <pre class="lab-activity-output oc-scrollable" tabIndex={0}>
            {output()}
          </pre>
        )}
      </Show>
    </li>
  );
}

/* All routine agent steps — tool calls, reasoning notes, retries — live in one
   group that collapses as soon as the turn is done. */
export function LabActivityGroup(props: {
  readonly items?: readonly LabActivityItem[];
  readonly state?: "running" | "done";
}) {
  const items = () => props.items ?? labActivity;
  const failed = () => items().filter((item) => item.status === "failed").length;
  const state = () => props.state ?? "done";
  const [expanded, setExpanded] = createSignal(state() === "running");
  const facts = () => `${items().length} steps${failed() > 0 ? ` · ${failed()} failed` : ""}`;
  return (
    <section class="lab-activity" aria-label="Activity">
      <button
        class="lab-activity-summary"
        type="button"
        aria-expanded={expanded()}
        onClick={() => setExpanded((current) => !current)}
      >
        <Icon
          class="lab-activity-summary-arrow"
          name={expanded() ? "chevron-down" : "chevron-right"}
          size="small"
          aria-hidden="true"
        />
        <span class="lab-activity-summary-label">Activity</span>
        <span class="lab-activity-summary-facts">{facts()}</span>
        <span class="lab-activity-summary-state" data-state={state()}>
          <Show
            when={state() === "running"}
            fallback={<Icon name="check" size="small" aria-hidden="true" />}
          >
            <Loader width={12} height={12} aria-hidden="true" />
          </Show>
          {state()}
        </span>
      </button>
      <Show when={expanded()}>
        <ul class="lab-activity-list">
          <For each={items()}>{(item) => <LabActivityRow item={item} />}</For>
        </ul>
      </Show>
    </section>
  );
}

function LabDecision(props: {
  readonly title: string;
  readonly detail: string;
  readonly resource: string;
}) {
  return (
    <section class="lab-decision" role="group" aria-label="Decision needed">
      <span class="lab-decision-kicker">Decision needed</span>
      <h2 class="lab-decision-title">{props.title}</h2>
      <p class="lab-decision-detail">{props.detail}</p>
      <p class="lab-decision-resource">{props.resource}</p>
      <div class="lab-decision-actions">
        <Button type="button" size="small" variant="danger" onClick={noop}>
          Reject
        </Button>
        <Button type="button" size="small" variant="outline" onClick={noop}>
          Always allow
        </Button>
        <Button type="button" size="small" variant="contrast" onClick={noop}>
          Allow once
        </Button>
      </div>
    </section>
  );
}

/* Outcome-oriented session state: where the work stands and what is left,
   deliberately quieter than the record it closes. No counts, no actions. */
export function LabStateSummary(props: {
  readonly headline: string;
  readonly detail: string;
  readonly next: string;
  readonly tone?: "default" | "danger";
  readonly stale?: boolean;
}) {
  return (
    <section
      class="lab-state-summary"
      data-tone={props.tone ?? "default"}
      aria-label="Session state"
    >
      <p class="lab-state-summary-line">
        <span class="lab-state-summary-label">
          {props.stale === true ? "Last known state" : "Session state"}
        </span>
        <span class="lab-state-summary-headline">{props.headline}</span>
      </p>
      <p class="lab-state-summary-detail">{props.detail}</p>
      <p class="lab-state-summary-next">
        <strong>Next</strong> {props.next}
      </p>
      <Show when={props.stale === true}>
        <p class="lab-state-summary-stale">
          Connection lost — progress since this point is unknown.
        </p>
      </Show>
    </section>
  );
}

/* --- File tree ------------------------------------------------------------ */

type LabTreeNode = {
  readonly name: string;
  readonly path: string;
  readonly file?: DiffFileData;
  readonly children: LabTreeNode[];
};

type LabTreeMutableNode = {
  name: string;
  path: string;
  file?: DiffFileData;
  children: Map<string, LabTreeMutableNode>;
};

function freezeLabTreeNode(node: LabTreeMutableNode): LabTreeNode {
  return {
    name: node.name,
    path: node.path,
    file: node.file,
    children: [...node.children.values()].map(freezeLabTreeNode),
  };
}

/* Compact folders: merge single-folder chains so a diff path reads as one
   row (…/SessionPane/Composer) instead of six indented levels. */
function compressLabTreeNode(node: LabTreeNode): LabTreeNode {
  const names = [node.name];
  let current = node;
  while (current.file === undefined && current.children.length === 1) {
    const only = current.children[0];
    if (only === undefined || only.file !== undefined) break;
    current = only;
    names.push(current.name);
  }
  return {
    name: names.join("/"),
    path: current.path,
    file: current.file,
    children: current.children.map(compressLabTreeNode),
  };
}

function buildLabTree(files: readonly DiffFileData[]): LabTreeNode[] {
  const root: LabTreeMutableNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    const parts = file.file.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path, children: new Map() };
        node.children.set(part, child);
      }
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }
  return [...root.children.values()].map(freezeLabTreeNode).map(compressLabTreeNode);
}

function LabTreeBranch(props: {
  readonly node: LabTreeNode;
  readonly depth: number;
  readonly selectedFile: string;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
}) {
  const folder = () => props.node.file === undefined;
  const open = () => !props.collapsed.has(props.node.path);
  return (
    <li class="lab-tree-node">
      <Show
        when={folder()}
        fallback={
          <button
            type="button"
            class="lab-tree-file"
            data-selected={props.node.file?.file === props.selectedFile ? "" : undefined}
            aria-current={props.node.file?.file === props.selectedFile ? "true" : undefined}
            style={{ "padding-left": `${props.depth * 12 + 6}px` }}
            onClick={noop}
          >
            <Icon name="open-file" size="small" aria-hidden="true" />
            <span class="lab-tree-name">{props.node.name}</span>
            <span class="lab-tree-stats">
              +{props.node.file?.additions ?? 0} −{props.node.file?.deletions ?? 0}
            </span>
          </button>
        }
      >
        <button
          type="button"
          class="lab-tree-folder"
          aria-expanded={open()}
          style={{ "padding-left": `${props.depth * 12 + 6}px` }}
          onClick={() => props.onToggle(props.node.path)}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" aria-hidden="true" />
          <span class="lab-tree-name">{props.node.name}</span>
        </button>
        <Show when={open()}>
          <ul class="lab-tree-children">
            <For each={props.node.children}>
              {(child) => (
                <LabTreeBranch
                  node={child}
                  depth={props.depth + 1}
                  selectedFile={props.selectedFile}
                  collapsed={props.collapsed}
                  onToggle={props.onToggle}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </li>
  );
}

function LabReviewTree(props: { readonly selectedFile: string }) {
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const roots = buildLabTree(labDiffFiles);
  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  return (
    <nav class="lab-tree" aria-label="Changed files">
      <p class="lab-tree-heading">
        {labDiffFiles.length} files · +{labDiffAdded} −{labDiffRemoved}
      </p>
      <ul class="lab-tree-list">
        <For each={roots}>
          {(node) => (
            <LabTreeBranch
              node={node}
              depth={0}
              selectedFile={props.selectedFile}
              collapsed={collapsed()}
              onToggle={toggle}
            />
          )}
        </For>
      </ul>
    </nav>
  );
}

/* --- Work record ---------------------------------------------------------- */

function LabWorkRecord() {
  return (
    <div class="lab-record oc-scrollable">
      <article class="lab-brief">
        <span class="lab-brief-label">Instruction</span>
        <p class="lab-brief-text">{labInstruction}</p>
        <ul class="lab-attachments">
          <li>
            <Icon name="open-file" size="small" aria-hidden="true" />
            release.md
          </li>
          <li>/Users/alex/code/oc-ui</li>
        </ul>
      </article>
      <p class="lab-prose">{labProseBefore}</p>
      <LabActivityGroup state="done" />
      <p class="lab-event">
        <strong>Model switched</strong> openai/gpt-5 → openai/gpt-5-mini
      </p>
      <p class="lab-prose">{labProseAfter}</p>
      <PermissionRequestCard request={labPermission} onReply={noop} />
      <LabStateSummary
        headline={labStateSummary.headline}
        detail={labStateSummary.detail}
        next={labStateSummary.next}
      />
    </div>
  );
}

/* --- Workbench ------------------------------------------------------------ */

export function WorkbenchReturn() {
  return (
    <div class="lab-page">
      <AppShell
        titlebar={<LabTitlebar title="Release notes audit" rightPanelOpen={false} />}
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={<LabSidebar selectedID="audit" />}
            main={
              <div class="lab-workbench">
                <LabWorkRecord />
                <LabComposer action="send" />
              </div>
            }
          />
        }
      />
    </div>
  );
}

export function WorkbenchReview() {
  const [expanded, setExpanded] = createSignal(false);
  const selectedFile = labDiffFiles[0]?.file ?? "";

  return (
    <div class="lab-page">
      <AppShell
        titlebar={
          <LabTitlebar
            title="Release notes audit"
            rightPanelOpen={!expanded()}
            rightControls={<LabContextActions onExpand={() => setExpanded(true)} />}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={!expanded()}
            sidebar={<LabSidebar selectedID="audit" />}
            main={
              <Show
                when={expanded()}
                fallback={
                  <div class="lab-workbench">
                    <LabWorkRecord />
                    <LabComposer action="send" />
                  </div>
                }
              >
                <div class="lab-review">
                  <header class="lab-review-header">
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      onClick={() => setExpanded(false)}
                    >
                      Back to the record
                    </Button>
                    <span class="lab-review-title">Reviewing {labDiffFiles.length} files</span>
                    <span class="lab-review-facts">
                      +{labDiffAdded} −{labDiffRemoved}
                    </span>
                  </header>
                  <div class="lab-review-body">
                    <div class="lab-review-content">
                      <LabReviewTree selectedFile={selectedFile} />
                      <div class="lab-review-diff">
                        <ContextPanel
                          files={labDiffFiles}
                          presentation={{ loading: false }}
                          showTabs={false}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Show>
            }
            context={
              <ChangesRegion
                idBase="lab-workbench-context"
                files={labDiffFiles}
                presentation={{ loading: false }}
                showTabs={false}
              />
            }
          />
        }
      />
    </div>
  );
}

export function WorkbenchAttentionFilter() {
  return (
    <div class="lab-page">
      <AppShell
        titlebar={<LabTitlebar title="Release notes audit" rightPanelOpen={false} />}
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={<LabAttentionSidebar />}
            main={
              <div class="lab-workbench">
                <LabWorkRecord />
                <LabComposer action="send" />
              </div>
            }
          />
        }
      />
    </div>
  );
}

/* --- Notebook ------------------------------------------------------------- */

export function NotebookReturn() {
  return (
    <div class="lab-page">
      <AppShell
        titlebar={<LabTitlebar title="Release notes audit" rightPanelOpen={false} />}
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={<LabSidebar selectedID="audit" />}
            main={
              <div class="lab-notebook oc-scrollable">
                <div class="lab-notebook-page">
                  <article class="lab-brief">
                    <span class="lab-brief-label">Instruction · Release notes audit</span>
                    <p class="lab-brief-text">{labInstruction}</p>
                    <p class="lab-brief-meta">
                      release.md · /Users/alex/code/oc-ui · 7 minutes ago
                    </p>
                  </article>
                  <section class="lab-note">
                    <p class="lab-prose">{labProseBefore}</p>
                    <ul class="lab-evidence">
                      <For each={labActivity}>
                        {(item) => (
                          <li class="lab-evidence-row">
                            <span class="lab-evidence-label">tool</span>
                            <span class="lab-evidence-detail">
                              {item.name}
                              {item.parameter ? ` ${item.parameter}` : ""}
                            </span>
                            <span class="lab-evidence-status" data-status={item.status}>
                              {activityStatusLabel(item)}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                    <p class="lab-prose">{labProseAfter}</p>
                    <LabStateSummary
                      headline={labStateSummary.headline}
                      detail={labStateSummary.detail}
                      next={labStateSummary.next}
                    />
                    <LabDecision
                      title="Run git push origin release?"
                      detail="The audit is finished. Publishing the release branch is the next step."
                      resource="git push origin release"
                    />
                  </section>
                  <LabComposer action="send" />
                </div>
              </div>
            }
          />
        }
      />
    </div>
  );
}

export function NotebookReview() {
  return (
    <div class="lab-page">
      <AppShell
        titlebar={<LabTitlebar title="Release notes audit" rightPanelOpen={false} />}
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={<LabSidebar selectedID="audit" />}
            main={
              <div class="lab-notebook oc-scrollable">
                <div class="lab-notebook-page lab-notebook-page-review">
                  <header class="lab-brief">
                    <span class="lab-brief-label">Review · Release notes audit</span>
                    <p class="lab-brief-text">
                      {labDiffFiles.length} files · +{labDiffAdded} −{labDiffRemoved}
                    </p>
                    <p class="lab-brief-meta">
                      <Button type="button" size="small" variant="ghost-muted" onClick={noop}>
                        Back to the record
                      </Button>
                    </p>
                  </header>
                  <section class="lab-note">
                    <ContextPanel
                      files={labDiffFiles}
                      presentation={{ loading: false }}
                      showTabs={false}
                    />
                  </section>
                </div>
              </div>
            }
          />
        }
      />
    </div>
  );
}

/* --- Dispatch ------------------------------------------------------------- */

const runStateLabels = {
  running: "Working",
  attention: "Needs input",
  idle: "Idle",
  finished: "Finished",
} satisfies Record<LabRun["state"], string>;

export function DispatchReturn() {
  return (
    <div class="lab-page">
      <AppShell
        titlebar={<LabTitlebar title="Runs" rightPanelOpen />}
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen
            sidebar={<LabSidebar selectedID="flaky" />}
            main={
              <div class="lab-dispatch">
                <header class="lab-dispatch-header">
                  <h2 class="lab-dispatch-title">Runs</h2>
                  <span class="lab-dispatch-facts">
                    2 working · 1 needs input · 4 finished today
                  </span>
                </header>
                <div class="lab-dispatch-scroll oc-scrollable">
                  <div class="lab-dispatch-head" aria-hidden="true">
                    <span>Session</span>
                    <span>Location</span>
                    <span>State</span>
                    <span>Last event</span>
                    <span>Changed</span>
                  </div>
                  <ul class="lab-dispatch-list" aria-label="Runs">
                    <For each={labRuns}>
                      {(run) => (
                        <li class="lab-dispatch-item">
                          <button
                            type="button"
                            class="lab-dispatch-row"
                            data-selected={run.sessionID === "flaky" ? "" : undefined}
                            aria-current={run.sessionID === "flaky" ? "true" : undefined}
                            onClick={noop}
                          >
                            <span class="lab-dispatch-session">
                              <span class="lab-dispatch-session-title">{run.title}</span>
                              <span class="lab-dispatch-location">{run.sessionID}</span>
                            </span>
                            <span class="lab-dispatch-location">{run.location}</span>
                            <span class="lab-state" data-state={run.state}>
                              {runStateLabels[run.state]}
                            </span>
                            <span class="lab-dispatch-event">{run.lastEvent}</span>
                            <span class="lab-dispatch-changed">{run.changed}</span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>
            }
            context={
              <aside class="lab-inspector" aria-label="Run inspector">
                <header class="lab-inspector-header">
                  <h2 class="lab-inspector-title">Fix flaky scroll test</h2>
                  <p class="lab-inspector-meta">/Users/alex/code/oc-ui · worktree flaky-scroll</p>
                  <span class="lab-state" data-state="attention">
                    Needs input
                  </span>
                </header>
                <div class="lab-inspector-body oc-scrollable">
                  <LabDecision
                    title="Run pnpm test -- --project storybook?"
                    detail={labFlakyPermission.message ?? ""}
                    resource={labFlakyPermission.resources[0] ?? ""}
                  />
                  <section class="lab-inspector-section">
                    <h3 class="lab-rail-title">Recent activity</h3>
                    <ul class="lab-activity-list">
                      <For each={labActivity.slice(0, 3)}>
                        {(item) => <LabActivityRow item={item} />}
                      </For>
                    </ul>
                  </section>
                </div>
                <footer class="lab-inspector-footer">
                  <Button type="button" size="small" variant="outline" onClick={noop}>
                    Review changes
                  </Button>
                  <Button type="button" size="small" variant="contrast" onClick={noop}>
                    Open record
                  </Button>
                </footer>
              </aside>
            }
          />
        }
      />
    </div>
  );
}
