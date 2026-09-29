import { ScrollView } from "@opencode/ui/scroll-view";
import type { PermissionReply } from "@opencode/client";
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { TextInput } from "@opencode/ui/text-input";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionHeader } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionHeader.tsx";
import { SessionTree } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionTree.tsx";
import { AppShell } from "../../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { PermissionRequestCard } from "../../src/renderer/ui/PermissionRequestCard.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";

import { LabActivityGroup, LabStateSummary } from "./ScenarioLab.tsx";
import {
  labSupervisionAttention,
  labSupervisionNow,
  labSupervisionPermissions,
  labSupervisionQuestion,
  labSupervisionSessions,
  supervisionRecord,
  type SupervisionAttentionKind,
} from "./supervision-fixtures.ts";

import "./SupervisionLab.css";

const noop = () => undefined;

/* Production attention vocabulary is narrower than the lab needs: an
   unsuccessful ending still reports as an unread completion. */
function toSessionAttention(kind: SupervisionAttentionKind | undefined) {
  if (kind === "permission") return "permission" as const;
  if (kind === "question") return "question" as const;
  if (kind === "success" || kind === "failed") return "completed" as const;
  return undefined;
}

export function WorkbenchSupervision() {
  const [filter, setFilter] = createSignal<"all" | "needs-you">("needs-you");
  const [selectedID, setSelectedID] = createSignal("audit");
  const [readEndings, setReadEndings] = createSignal<ReadonlySet<string>>(new Set());
  const [resolvedRequests, setResolvedRequests] = createSignal<ReadonlySet<string>>(new Set());
  const [resolvedReplies, setResolvedReplies] = createSignal<ReadonlyMap<string, PermissionReply>>(
    new Map(),
  );
  const [drafts, setDrafts] = createSignal<ReadonlyMap<string, string>>(new Map());

  let record: HTMLDivElement | undefined;
  const scrollMemory = new Map<string, number>();
  let previousID: string | undefined;

  const attentionKind = (id: string): SupervisionAttentionKind | undefined => {
    const kind = labSupervisionAttention.get(id);
    if (kind === undefined) return undefined;
    if (kind === "permission" || kind === "question") {
      return resolvedRequests().has(id) ? undefined : kind;
    }
    return readEndings().has(id) ? undefined : kind;
  };

  const attentionCount = createMemo(
    () =>
      labSupervisionSessions.filter((session) => attentionKind(session.id) !== undefined).length,
  );

  const visibleSessions = createMemo(() => {
    if (filter() === "all") return labSupervisionSessions;
    const byID = new Map(labSupervisionSessions.map((session) => [session.id, session]));
    const keep = new Set<string>();
    for (const session of labSupervisionSessions) {
      if (attentionKind(session.id) === undefined) continue;
      keep.add(session.id);
      let parentID = session.parentID;
      while (parentID !== undefined) {
        keep.add(parentID);
        parentID = byID.get(parentID)?.parentID;
      }
    }
    return labSupervisionSessions.filter((session) => keep.has(session.id));
  });

  const selected = createMemo(() => labSupervisionSessions.find((s) => s.id === selectedID()));
  const selectedKind = () => attentionKind(selectedID());
  const selectedPermission = () => labSupervisionPermissions.get(selectedID());
  const draft = () => drafts().get(selectedID()) ?? "";

  const setDraft = (value: string) => {
    const id = selectedID();
    setDrafts((current) => new Map(current).set(id, value));
  };

  const markReadIfExposed = () => {
    const id = selectedID();
    const kind = labSupervisionAttention.get(id);
    if (kind !== "success" && kind !== "failed") return;
    if (record === undefined) return;
    const exposed = record.scrollTop + record.clientHeight >= record.scrollHeight - 24;
    if (!exposed) return;
    setReadEndings((current) => (current.has(id) ? current : new Set([...current, id])));
  };

  // Preserve per-session reading position; reading an unread ending happens
  // when the reader actually reaches it.
  createEffect(() => {
    const id = selectedID();
    if (record === undefined) return;
    if (previousID !== undefined && previousID !== id) {
      scrollMemory.set(previousID, record.scrollTop);
    }
    previousID = id;
    queueMicrotask(() => {
      if (record === undefined || selectedID() !== id) return;
      record.scrollTop = scrollMemory.get(id) ?? 0;
      markReadIfExposed();
    });
  });

  const resolvePermission = (reply: PermissionReply) => {
    const id = selectedID();
    setResolvedReplies((current) => new Map(current).set(id, reply));
    setResolvedRequests((current) => new Set([...current, id]));
  };

  return (
    <div class="lab-page">
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle={selected()?.title ?? "No session selected"}
            leftSidebarOpen
            rightPanelOpen={false}
            rightPanelAvailable={false}
            globalControls={
              <span class="lab-location" title={selected()?.location.directory}>
                {selected()?.location.directory ?? ""}
              </span>
            }
            onToggleLeftSidebar={noop}
            onToggleRightPanel={noop}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={
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
                      aria-pressed={filter() === "all"}
                      onClick={() => setFilter("all")}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      class="lab-attention-filter-button"
                      aria-pressed={filter() === "needs-you"}
                      onClick={() => setFilter("needs-you")}
                    >
                      Needs you
                      <span class="lab-attention-filter-count">{attentionCount()}</span>
                    </button>
                  </div>
                </div>
                <ScrollView class="shell-session-tree" thumbVisibility="scroll">
                  <SessionTree
                    attentionForSession={(id) => toSessionAttention(attentionKind(id))}
                    sessions={visibleSessions()}
                    now={labSupervisionNow + 60 * 1000}
                    statusForSession={(id) => (id === "composer-cleanup" ? "running" : "idle")}
                    selectedID={selectedID()}
                    expandedIDs={["audit", "releases", "worktree"]}
                    canDelete
                    deletionStatusForSession={() => "ready"}
                    onSelect={setSelectedID}
                    onToggleExpanded={noop}
                    onDelete={noop}
                  />
                </ScrollView>
              </aside>
            }
            main={
              <Show when={selected()} fallback={<div class="lab-record">Select a session.</div>}>
                {(session) => (
                  <div class="lab-workbench">
                    <div
                      ref={(element) => {
                        record = element;
                      }}
                      class="lab-record oc-scrollable"
                      onScroll={markReadIfExposed}
                    >
                      <article class="lab-brief">
                        <span class="lab-brief-label">Instruction</span>
                        <p class="lab-brief-text">{supervisionRecord(session().id).instruction}</p>
                        <ul class="lab-attachments">
                          <li>{session().location.directory}</li>
                        </ul>
                      </article>
                      <p class="lab-prose">{supervisionRecord(session().id).prose}</p>
                      <LabActivityGroup
                        items={supervisionRecord(session().id).activity}
                        state="done"
                      />
                      <Show when={selectedKind() === "permission" && selectedPermission()}>
                        {(request) => (
                          <PermissionRequestCard request={request()} onReply={resolvePermission} />
                        )}
                      </Show>
                      <Show when={selectedKind() === "question"}>
                        <fieldset class="lab-question" aria-labelledby="lab-question-title">
                          <legend class="lab-decision-kicker">Question</legend>
                          <h2 id="lab-question-title" class="lab-decision-title">
                            {labSupervisionQuestion.title}
                          </h2>
                          <p class="lab-decision-detail">{labSupervisionQuestion.detail}</p>
                          <div class="lab-question-options">
                            <For each={labSupervisionQuestion.options}>
                              {(option, index) => (
                                <label class="lab-question-option">
                                  <input
                                    type="radio"
                                    name="lab-supervision-question"
                                    checked={index() === 0}
                                    onChange={noop}
                                  />
                                  <span>{option}</span>
                                </label>
                              )}
                            </For>
                          </div>
                          <div class="lab-decision-actions">
                            <Button
                              type="button"
                              size="small"
                              variant="contrast"
                              onClick={() => {
                                const id = selectedID();
                                setResolvedRequests((current) => new Set([...current, id]));
                              }}
                            >
                              Submit answer
                            </Button>
                          </div>
                        </fieldset>
                      </Show>
                      <Show when={resolvedRequests().has(selectedID())}>
                        <p class="lab-resolved">
                          <Icon name="check" size="small" aria-hidden="true" />
                          Request resolved
                          {resolvedReplies().has(selectedID())
                            ? ` · ${resolvedReplies().get(selectedID())}`
                            : ""}{" "}
                          — the agent continues from here.
                        </p>
                      </Show>
                      <LabStateSummary
                        headline={supervisionRecord(session().id).summary.headline}
                        detail={supervisionRecord(session().id).summary.detail}
                        next={supervisionRecord(session().id).summary.next}
                        tone={supervisionRecord(session().id).summary.tone}
                      />
                    </div>
                    <Composer
                      value={draft()}
                      action="send"
                      disabled={false}
                      modelSelection={composerModelSelection()}
                      agentSelection={composerAgentSelection()}
                      onInput={setDraft}
                      onAttachText={noop}
                      onSubmit={noop}
                      onStop={noop}
                    />
                  </div>
                )}
              </Show>
            }
          />
        }
      />
    </div>
  );
}
