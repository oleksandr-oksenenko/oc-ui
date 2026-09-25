import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { For, Show, createSignal } from "solid-js";

import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionSidebar } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar.tsx";
import { AppShell } from "../../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { PermissionRequestCard } from "../../src/renderer/ui/PermissionRequestCard.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";

import { LabActivityGroup, LabStateSummary } from "./ScenarioLab.tsx";
import {
  labActivity,
  labInstruction,
  labNow,
  labPermission,
  labSessions,
  labStateSummary,
} from "./lab-fixtures.ts";

import "./ApprovalLab.css";

const noop = () => undefined;

type ApprovalState = "pending" | "sending" | "unconfirmed" | "delivered" | "not-delivered";
type Branch = "accepted" | "still-pending";

const stateLabels = {
  pending: "Waiting for your reply",
  sending: "Sending your reply",
  unconfirmed: "Delivery unconfirmed",
  delivered: "Reply delivered",
  "not-delivered": "Reply not delivered",
} satisfies Record<ApprovalState, string>;

/* Moment B — "Did that approval go through?" The reply is sent, the connection
   drops before acknowledgment, and the outcome stays unknown until the client
   reconciles. Nothing here may claim the command ran, failed, or stopped. */
export function WorkbenchApprovalUncertainty() {
  const [state, setState] = createSignal<ApprovalState>("pending");
  const [branch, setBranch] = createSignal<Branch>("accepted");
  const [draft, setDraft] = createSignal("");

  const reconcile = () => {
    if (state() !== "unconfirmed") return;
    setState(branch() === "accepted" ? "delivered" : "not-delivered");
  };

  const reset = () => {
    setState("pending");
    setDraft("");
  };

  return (
    <div class="lab-page">
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Release notes audit"
            leftSidebarOpen
            rightPanelOpen={false}
            rightPanelAvailable={false}
            globalControls={<span class="lab-location">/Users/alex/code/oc-ui</span>}
            onToggleLeftSidebar={noop}
            onToggleRightPanel={noop}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen
            rightPanelOpen={false}
            sidebar={
              <SessionSidebar
                sessions={labSessions}
                now={labNow + 60 * 1000}
                statusForSession={() => "idle"}
                attentionForSession={(id) =>
                  id === "audit" && state() !== "delivered" ? "permission" : undefined
                }
                selectedID="audit"
                expandedIDs={["audit", "worktree"]}
                loading={false}
                canCreate
                canDelete
                deletionStatusForSession={() => "ready"}
                serverName="oc-ui · local"
                serverStatus={state() === "unconfirmed" ? "reconnecting" : "connected"}
                onSelect={noop}
                onToggleExpanded={noop}
                onDelete={noop}
                onCreate={noop}
                onRetry={noop}
                onSelectServer={noop}
              />
            }
            main={
              <div class="lab-workbench">
                <div class="lab-lab-controls">
                  <span class="lab-lab-controls-label">Lab controls</span>
                  <span class="lab-lab-controls-state">{stateLabels[state()]}</span>
                  <div class="lab-run-actions">
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      disabled={state() !== "sending"}
                      onClick={() => setState("unconfirmed")}
                    >
                      <Icon name="cloud-upload" size="small" aria-hidden="true" />
                      Drop connection
                    </Button>
                    <div class="lab-branch" role="group" aria-label="Simulated outcome">
                      <For each={["accepted", "still-pending"] as const}>
                        {(value) => (
                          <button
                            type="button"
                            class="lab-branch-button"
                            aria-pressed={branch() === value}
                            onClick={() => setBranch(value)}
                          >
                            {value === "accepted" ? "Outcome: accepted" : "Outcome: still pending"}
                          </button>
                        )}
                      </For>
                    </div>
                    <Button type="button" size="small" variant="ghost-muted" onClick={reset}>
                      Reset
                    </Button>
                  </div>
                </div>
                <div class="lab-record oc-scrollable">
                  <article class="lab-brief">
                    <span class="lab-brief-label">Instruction</span>
                    <p class="lab-brief-text">{labInstruction}</p>
                    <ul class="lab-attachments">
                      <li>/Users/alex/code/oc-ui</li>
                    </ul>
                  </article>
                  <p class="lab-prose">
                    The layout pass is applied and the check passed on the re-run. Publishing the
                    release branch is the only thing left.
                  </p>
                  <LabActivityGroup items={labActivity} state="done" />

                  <Show when={state() === "pending" || state() === "sending"}>
                    <PermissionRequestCard
                      request={labPermission}
                      submitting={state() === "sending"}
                      onReply={() => setState("sending")}
                    />
                  </Show>

                  <Show when={state() === "unconfirmed"}>
                    <section class="lab-uncertain" role="group" aria-label="Unconfirmed reply">
                      <span class="lab-decision-kicker">Unconfirmed</span>
                      <h2 class="lab-decision-title">
                        Your reply was sent, but delivery is unknown.
                      </h2>
                      <p class="lab-decision-detail">
                        The connection dropped while sending “Allow once”. The reply was not sent
                        again, and this request has no live approval control until the client
                        reconciles with the server.
                      </p>
                      <p class="lab-decision-resource">{labPermission.resources[0]}</p>
                      <div class="lab-decision-actions">
                        <Button type="button" size="small" variant="outline" onClick={reconcile}>
                          Reconnect &amp; reconcile
                        </Button>
                      </div>
                    </section>
                  </Show>

                  <Show when={state() === "delivered"}>
                    <section class="lab-approval-note" role="status">
                      <Icon name="check" size="small" aria-hidden="true" />
                      <div>
                        <p class="lab-approval-note-title">
                          Reply delivered. The agent ran <code>git push origin release</code> and
                          continued.
                        </p>
                        <p class="lab-approval-note-detail">
                          Reconciliation confirmed the reply; the request is resolved and nothing
                          needs you.
                        </p>
                      </div>
                    </section>
                  </Show>

                  <Show when={state() === "not-delivered"}>
                    <section class="lab-approval-note" data-tone="warning" role="status">
                      <Icon name="warning" size="small" aria-hidden="true" />
                      <div>
                        <p class="lab-approval-note-title">
                          The reply never arrived. The request is still pending.
                        </p>
                        <p class="lab-approval-note-detail">
                          Reconciliation showed the server never received the reply, so the decision
                          is yours again — the request below is live.
                        </p>
                      </div>
                    </section>
                    <PermissionRequestCard
                      request={labPermission}
                      onReply={() => setState("sending")}
                    />
                  </Show>

                  <LabStateSummary
                    headline={labStateSummary.headline}
                    detail={labStateSummary.detail}
                    next={labStateSummary.next}
                    stale={state() === "unconfirmed"}
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
            }
          />
        }
      />
    </div>
  );
}
