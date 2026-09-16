import type { FormAnswer } from "@opencode/client";
import { Badge } from "@opencode/ui/badge";
import { Button } from "@opencode/ui/button";
import { useDialog } from "@opencode/ui/context/dialog";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode/ui/dialog";
import { Icon } from "@opencode/ui/icon";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";

import { QuestionForm } from "../../../../ui/QuestionForm.tsx";
import { useServerFlowDismissBlock } from "../../../../ui/ServerFlowDialogProvider.tsx";
import type { GlobalFormsController } from "./createGlobalForms.ts";

export type AnswerStore = Map<string, FormAnswer>;

export type ReviewDialogProps = {
  readonly controller: GlobalFormsController;
  readonly answers: AnswerStore;
  readonly onAnswerChange: (formID: string, answer: FormAnswer) => void;
  readonly onOpenExternal?: (url: string) => void;
  readonly initialFormID?: string;
};

export function ReviewDialog(props: ReviewDialogProps): JSX.Element {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  const [selectedID, setSelectedID] = createSignal(props.initialFormID ?? "");
  const [settledFormIDs, setSettledFormIDs] = createSignal<ReadonlySet<string>>(new Set());
  let previousFormIDs: readonly string[] = [];
  let focusedQueueID: string | undefined;
  const focusedAfterSettlementIDs = new Set<string>();
  const settlingFormIDs = new Set<string>();
  const settlementNextIDs = new Map<string, string | undefined>();
  const queueButtons = new Map<string, HTMLButtonElement>();
  const forms = () => props.controller.forms();
  const selected = createMemo(() => forms().find((form) => form.id === selectedID()));

  createEffect(() => setDismissBlocked(props.controller.pending()));
  onCleanup(() => setDismissBlocked(false));

  createEffect(() => {
    const current = forms();
    const id = selectedID();
    if (current.length === 0) {
      if (id) setSelectedID("");
      focusedQueueID = undefined;
      queueButtons.clear();
      previousFormIDs = [];
      return;
    }
    if (!current.some((form) => form.id === id)) {
      const repairQueueFocus = focusedQueueID === id;
      const previousIndex = previousFormIDs.indexOf(id);
      const nextIndex = previousIndex < 0 ? 0 : Math.min(previousIndex, current.length - 1);
      const next = current[nextIndex];
      if (next) {
        if (settlingFormIDs.has(id)) settlementNextIDs.set(id, next.id);
        setSelectedID(next.id);
        if (repairQueueFocus) {
          queueMicrotask(() => queueButtons.get(next.id)?.focus({ preventScroll: true }));
        }
      }
    }
    const currentIDs = new Set(current.map((form) => form.id));
    for (const requestID of queueButtons.keys()) {
      if (!currentIDs.has(requestID)) queueButtons.delete(requestID);
    }
    previousFormIDs = current.map((form) => form.id);
  });

  createEffect(() => {
    const settledIDs = settledFormIDs();
    for (const settledID of settledIDs) {
      if (focusedAfterSettlementIDs.has(settledID)) continue;
      if (forms().some((form) => form.id === settledID)) continue;
      const nextID = settlementNextIDs.get(settledID) ?? forms()[0]?.id;
      focusedAfterSettlementIDs.add(settledID);
      if (nextID) queueMicrotask(() => queueButtons.get(nextID)?.focus({ preventScroll: true }));
    }
  });

  const disconnected = () => !props.controller.connected();
  const selectedPending = () => {
    const current = selected();
    return current !== undefined && props.controller.submitting(current.id);
  };
  const actionError = () => {
    const current = selected();
    return current ? props.controller.errorFor(current.id) : undefined;
  };
  const settle = async (kind: "reply" | "cancel", answer?: FormAnswer) => {
    const form = selected();
    if (!form || disconnected() || props.controller.submitting(form.id)) {
      return;
    }
    const formID = form.id;
    settlingFormIDs.add(formID);
    const formIndex = forms().findIndex((candidate) => candidate.id === formID);
    settlementNextIDs.set(formID, forms()[formIndex + 1]?.id ?? forms()[formIndex - 1]?.id);
    const settled =
      kind === "reply"
        ? await props.controller.reply(formID, answer ?? {})
        : await props.controller.cancel(formID);
    settlingFormIDs.delete(formID);
    if (settled) {
      setSettledFormIDs((current) => new Set([...current, formID]));
    } else {
      settlementNextIDs.delete(formID);
    }
  };
  const description = () => {
    const location = props.controller.location;
    const workspace = location.workspaceID ? ` · Workspace ${location.workspaceID}` : "";
    return `Review each global form before the server continues · ${location.directory}${workspace}`;
  };

  return (
    <Dialog size="x-large" containerClass="global-forms-region-dialog">
      <DialogHeader closeLabel="Close global forms dialog" hideClose={props.controller.pending()}>
        <DialogTitleGroup
          title={
            <span class="global-forms-region-dialog-title">
              Review global forms{" "}
              <Badge appearance="compact" variant="accent">
                {forms().length}
              </Badge>
            </span>
          }
          description={description()}
        />
      </DialogHeader>
      <DialogBody class="global-forms-region-dialog-body">
        <Show when={disconnected()}>
          <div class="global-forms-region-notice" role="status">
            Disconnected. Cached global forms are available for inspection, but responses are
            disabled.
          </div>
        </Show>
        <Show
          when={!props.controller.loading()}
          fallback={
            <div class="global-forms-region-state" role="status">
              Loading global forms…
            </div>
          }
        >
          <Show
            when={props.controller.loadError() === undefined || forms().length > 0}
            fallback={
              <div class="global-forms-region-state" role="alert">
                <p>{props.controller.loadError()}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnected()}
                  onClick={() => void props.controller.refresh()}
                >
                  Retry
                </Button>
              </div>
            }
          >
            <Show when={props.controller.loadError() !== undefined && forms().length > 0}>
              <div class="global-forms-region-notice" role="alert">
                <p>{props.controller.loadError()}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnected()}
                  onClick={() => void props.controller.refresh()}
                >
                  Retry
                </Button>
              </div>
            </Show>
            <Show
              when={forms().length > 0}
              fallback={<div class="global-forms-region-state">No global forms</div>}
            >
              <div class="global-forms-region-dialog-layout">
                <aside
                  class="global-forms-region-request-list"
                  aria-label="Pending global forms"
                  onFocusOut={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      !(nextTarget instanceof Node) ||
                      !event.currentTarget.contains(nextTarget)
                    ) {
                      focusedQueueID = undefined;
                    }
                  }}
                >
                  <div class="global-forms-region-request-list-heading">
                    <span>Pending</span>
                    <Badge appearance="compact" variant="accent">
                      {forms().length}
                    </Badge>
                  </div>
                  <ul>
                    <For each={forms()}>
                      {(request) => (
                        <li>
                          <Button
                            ref={(element: HTMLButtonElement) => {
                              queueButtons.set(request.id, element);
                            }}
                            autofocus={request.id === selectedID() && previousFormIDs.length === 0}
                            aria-current={request.id === selectedID() ? "true" : undefined}
                            class="global-forms-region-request"
                            disabled={props.controller.submitting(request.id)}
                            type="button"
                            variant={request.id === selectedID() ? "neutral" : "ghost-muted"}
                            onFocus={() => {
                              focusedQueueID = request.id;
                            }}
                            onClick={() => setSelectedID(request.id)}
                          >
                            <span class="global-forms-region-request-title">{request.title}</span>
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </aside>
                <Show
                  when={selected()}
                  fallback={<div class="global-forms-region-state">No global forms</div>}
                >
                  {(current) => (
                    <section class="global-forms-region-detail" aria-label="Global form details">
                      <p class="sr-only" role="status" aria-live="polite">
                        Global form{" "}
                        {forms().findIndex((candidate) => candidate.id === current().id) + 1} of{" "}
                        {forms().length} selected: {current().title}
                      </p>
                      <div class="global-forms-region-detail-body">
                        <QuestionForm
                          form={current()}
                          disabled={disconnected() || selectedPending()}
                          submitting={selectedPending()}
                          error={actionError()}
                          initialAnswer={props.answers.get(current().id)}
                          onAnswerChange={(answer) => props.onAnswerChange(current().id, answer)}
                          onSubmit={(answer) => void settle("reply", answer)}
                          onCancel={() => void settle("cancel")}
                          onOpenExternal={props.onOpenExternal}
                        />
                      </div>
                    </section>
                  )}
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </DialogBody>
      <DialogFooter>
        <span class="global-forms-region-footer-note">
          <Icon name="info" aria-hidden="true" />
          Nothing is sent until you submit a response.
        </span>
        <Button
          type="button"
          variant="ghost-muted"
          disabled={props.controller.pending()}
          onClick={() => dialog.close()}
        >
          Keep pending
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
