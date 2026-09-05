/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable text lists need keyboard access. */

import type { PermissionSavedInfo, Project } from "@opencode-ai/client";
import { Badge } from "@opencode-ai/ui/badge";
import { Button } from "@opencode-ai/ui/button";
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/dialog";
import { Loader } from "@opencode-ai/ui/loader";
import { Tabs } from "@opencode-ai/ui/tabs";
import { For, Show, createMemo, createSignal, type Accessor, type JSX } from "solid-js";

import type { PermissionsController } from "./createPermissions.ts";
import "./PermissionsDialog.css";

export type PermissionsDialogProps = {
  readonly controller: PermissionsController;
  readonly connected: Accessor<boolean>;
  readonly onOpenSession: (sessionID: string) => void;
};

const displayValue = (value: string): string => (value === "" ? "(empty)" : value);
const sessionLabel = (title: string | undefined, id: string): string => title?.trim() || id;

export function PermissionsDialog(props: PermissionsDialogProps): JSX.Element {
  const [tab, setTab] = createSignal("pending");
  const [confirmingRuleID, setConfirmingRuleID] = createSignal<string>();
  const revokeButtons = new Map<string, HTMLButtonElement>();
  const pendingCount = createMemo(() =>
    props.controller.inbox.entries().reduce((total, entry) => total + entry.requests.length, 0),
  );
  const rulesForProject = (projectID: string): readonly PermissionSavedInfo[] =>
    props.controller.saved.rules().filter((rule) => rule.projectID === projectID);
  const cancelRevoke = (ruleID: string): void => {
    setConfirmingRuleID(undefined);
    queueMicrotask(() => revokeButtons.get(ruleID)?.focus({ preventScroll: true }));
  };
  const confirmRevoke = (
    rule: PermissionSavedInfo,
    root: HTMLElement | undefined,
  ): Promise<void> => {
    const container = root?.closest<HTMLElement>(".permissions-dialog");
    const rows = container
      ? [...container.querySelectorAll<HTMLElement>("[data-saved-rule-id]")]
      : [];
    const rowIndex = root ? rows.indexOf(root) : -1;
    const ownedFocus = root?.contains(document.activeElement) === true;
    if (ownedFocus) root?.focus({ preventScroll: true });
    return props.controller.saved.remove(rule.id).then(() => {
      if (props.controller.saved.rules().some((candidate) => candidate.id === rule.id))
        return undefined;
      setConfirmingRuleID(undefined);
      if (!ownedFocus) return undefined;
      queueMicrotask(() => {
        if (
          !container?.isConnected ||
          (document.activeElement !== document.body &&
            document.activeElement !== document.documentElement)
        )
          return;
        const currentRows = [...container.querySelectorAll<HTMLElement>("[data-saved-rule-id]")];
        const next = currentRows[Math.min(Math.max(rowIndex, 0), currentRows.length - 1)];
        (
          next?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
          container.querySelector<HTMLButtonElement>(".permissions-saved-refresh:not(:disabled)") ??
          container.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Saved approvals"]')
        )?.focus({ preventScroll: true });
      });
      return undefined;
    });
  };

  const refreshRecovery = (): void => void props.controller.inbox.sync();

  const projectGroup = (project: Pick<Project, "id" | "canonical" | "name">) => {
    const rules = () => rulesForProject(project.id);
    const label = () => displayValue(project.name ?? project.canonical);
    return (
      <section class="permissions-project" aria-labelledby={`permissions-project-${project.id}`}>
        <div class="permissions-project-header">
          <div>
            <h3 id={`permissions-project-${project.id}`}>{label()}</h3>
            <Show when={project.name !== undefined && project.name !== project.canonical}>
              <p class="permissions-project-canonical">{displayValue(project.canonical)}</p>
            </Show>
            <p class="permissions-project-id">Project ID: {displayValue(project.id)}</p>
          </div>
          <Badge appearance="compact" variant="neutral">
            {rules().length}
          </Badge>
        </div>
        <Show
          when={rules().length > 0}
          fallback={<p class="permissions-empty-project">No saved approvals for this project.</p>}
        >
          <div class="permissions-rule-list">
            <For each={rules()}>
              {(rule) => {
                let root: HTMLElement | undefined;
                let cancelButton: HTMLButtonElement | undefined;
                const confirming = () => confirmingRuleID() === rule.id;
                const blocked = () =>
                  !props.connected() ||
                  props.controller.saved.state() !== "ready" ||
                  props.controller.pending();
                return (
                  <div
                    ref={(element) => {
                      root = element;
                    }}
                    class="permissions-rule"
                    role="group"
                    tabIndex={-1}
                    data-saved-rule-id={rule.id}
                    aria-label={`Saved approval ${displayValue(rule.action)} for ${displayValue(rule.resource)}`}
                  >
                    <dl class="permissions-values">
                      <div>
                        <dt>Action</dt>
                        <dd>{displayValue(rule.action)}</dd>
                      </div>
                      <div>
                        <dt>Resource pattern</dt>
                        <dd>{displayValue(rule.resource)}</dd>
                      </div>
                    </dl>
                    <Show
                      when={confirming()}
                      fallback={
                        <Button
                          ref={(element: HTMLButtonElement) => revokeButtons.set(rule.id, element)}
                          type="button"
                          size="small"
                          variant="outline"
                          disabled={blocked()}
                          aria-label={`Revoke saved approval for ${displayValue(rule.action)} and ${displayValue(rule.resource)}`}
                          onClick={() => {
                            setConfirmingRuleID(rule.id);
                            queueMicrotask(() => cancelButton?.focus({ preventScroll: true }));
                          }}
                        >
                          {props.controller.saved.removing(rule.id) ? "Revoking…" : "Revoke"}
                        </Button>
                      }
                    >
                      <div
                        id={`permissions-revoke-confirm-${rule.id}`}
                        class="permissions-revoke-confirmation"
                        role="alert"
                      >
                        <p>
                          Revoke <strong>{displayValue(rule.action)}</strong> for project {label()}{" "}
                          and resource <code>{displayValue(rule.resource)}</code>? This affects
                          future permission checks, not work already approved.
                        </p>
                        <Show when={props.controller.saved.errorFor(rule.id)}>
                          {(error) => <p class="permissions-row-error">{error()}</p>}
                        </Show>
                        <div class="permissions-revoke-actions">
                          <Button
                            ref={(element: HTMLButtonElement) => {
                              cancelButton = element;
                            }}
                            type="button"
                            size="small"
                            variant="ghost"
                            autofocus
                            data-server-flow-escape-trigger
                            aria-expanded="true"
                            aria-controls={`permissions-revoke-confirm-${rule.id}`}
                            onClick={() => cancelRevoke(rule.id)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="danger"
                            disabled={blocked()}
                            onClick={() => void confirmRevoke(rule, root)}
                          >
                            {props.controller.saved.removing(rule.id)
                              ? "Revoking…"
                              : "Confirm revoke"}
                          </Button>
                        </div>
                      </div>
                    </Show>
                    <Show when={!confirming() && props.controller.saved.errorFor(rule.id)}>
                      {(error) => <p class="permissions-row-error">{error()}</p>}
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>
    );
  };

  return (
    <Dialog fit containerClass="permissions-dialog">
      <DialogHeader closeLabel="Close permissions dialog">
        <DialogTitleGroup
          title="Permissions"
          description="Inspect pending requests across sessions and manage saved project approvals."
        />
      </DialogHeader>
      <DialogBody class="permissions-dialog-body">
        <Show when={props.controller.recoveryError()}>
          {(error) => (
            <div class="permissions-notice permissions-recovery" role="alert">
              <div>
                <strong>Permission recovery required</strong>
                <p>{error()}</p>
              </div>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!props.connected()}
                onClick={refreshRecovery}
              >
                Refresh permissions
              </Button>
            </div>
          )}
        </Show>
        <Show when={!props.connected()}>
          <div class="permissions-notice" role="status">
            Disconnected. Cached permissions remain available for inspection; navigation and
            revocation are disabled.
          </div>
        </Show>
        <Tabs value={tab()} onChange={setTab} variant="line" class="permissions-tabs">
          <Tabs.List aria-label="Permission views">
            <Tabs.Trigger value="pending" aria-label="Pending">
              Pending{" "}
              <Badge appearance="compact" variant="neutral">
                {pendingCount()}
              </Badge>
            </Tabs.Trigger>
            <Tabs.Trigger value="saved" aria-label="Saved approvals">
              Saved approvals
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="pending" class="permissions-tab-content">
            <div class="permissions-tab-toolbar">
              <p>Open a session to answer its requests in the conversation.</p>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!props.connected() || props.controller.pending()}
                onClick={() => void props.controller.inbox.sync()}
              >
                Refresh pending permissions
              </Button>
            </div>
            <Show when={props.connected() && props.controller.inbox.state() === "loading"}>
              <output class="permissions-state" aria-live="polite">
                <Loader width={16} height={16} aria-hidden="true" /> Loading pending permissions…
              </output>
            </Show>
            <Show when={props.controller.inbox.error()}>
              {(error) => (
                <div class="permissions-state permissions-error" role="alert">
                  {error()}
                </div>
              )}
            </Show>
            <Show
              when={props.controller.inbox.entries().length > 0}
              fallback={
                <Show when={props.controller.inbox.state() === "ready"}>
                  <p class="permissions-empty">No pending permission requests.</p>
                </Show>
              }
            >
              <div class="permissions-inbox-list">
                <For each={props.controller.inbox.entries()}>
                  {(entry) => {
                    const label = () => sessionLabel(entry.session.title, entry.session.id);
                    return (
                      <section
                        class="permissions-session"
                        role="group"
                        aria-label={`Permissions for ${label()}`}
                      >
                        <div class="permissions-session-header">
                          <div>
                            <h3>{label()}</h3>
                            <p>{displayValue(entry.session.location.directory)}</p>
                            <Show when={entry.session.location.workspaceID !== undefined}>
                              <p>
                                Workspace: {displayValue(entry.session.location.workspaceID ?? "")}
                              </p>
                            </Show>
                          </div>
                          <Button
                            type="button"
                            size="small"
                            variant="outline"
                            disabled={!props.connected()}
                            aria-label={`Open session ${label()}`}
                            onClick={() => props.onOpenSession(entry.session.id)}
                          >
                            Open session
                          </Button>
                        </div>
                        <div class="permissions-request-list">
                          <For each={entry.requests}>
                            {(request) => (
                              <article class="permissions-request">
                                <dl class="permissions-values">
                                  <div>
                                    <dt>Action</dt>
                                    <dd>{displayValue(request.action)}</dd>
                                  </div>
                                  <div>
                                    <dt>Resources</dt>
                                    <dd>
                                      <Show
                                        when={request.resources.length > 0}
                                        fallback={<span>(none)</span>}
                                      >
                                        <ul
                                          class="permissions-resource-values"
                                          data-permission-resources
                                          aria-label="Requested resources"
                                          tabIndex={0}
                                        >
                                          <For each={request.resources}>
                                            {(resource) => <li>{displayValue(resource)}</li>}
                                          </For>
                                        </ul>
                                      </Show>
                                    </dd>
                                  </div>
                                </dl>
                              </article>
                            )}
                          </For>
                        </div>
                      </section>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Tabs.Content>

          <Tabs.Content value="saved" class="permissions-tab-content">
            <div class="permissions-tab-toolbar">
              <p>Saved approvals apply to future permission checks in their project.</p>
              <Button
                class="permissions-saved-refresh"
                type="button"
                size="small"
                variant="outline"
                disabled={!props.connected() || props.controller.pending()}
                onClick={() => void props.controller.saved.sync()}
              >
                Refresh saved approvals
              </Button>
            </div>
            <Show when={props.connected() && props.controller.saved.state() === "loading"}>
              <output class="permissions-state" aria-live="polite">
                <Loader width={16} height={16} aria-hidden="true" /> Loading saved approvals…
              </output>
            </Show>
            <Show when={props.controller.saved.error()}>
              {(error) => (
                <div class="permissions-state permissions-error" role="alert">
                  {error()}
                </div>
              )}
            </Show>
            <Show
              when={props.controller.saved.projects().length > 0}
              fallback={
                <Show when={props.controller.saved.state() === "ready"}>
                  <p class="permissions-empty">No projects are available.</p>
                </Show>
              }
            >
              <div class="permissions-project-list">
                <For each={props.controller.saved.projects()}>{projectGroup}</For>
              </div>
            </Show>
          </Tabs.Content>
        </Tabs>
      </DialogBody>
    </Dialog>
  );
}
