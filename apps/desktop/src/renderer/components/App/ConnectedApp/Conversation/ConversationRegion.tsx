import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createMemo, onCleanup, type JSX } from "solid-js";

import type { AnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { createTranscriptAnnotations } from "./createTranscriptAnnotations.ts";
import { AnnotationPopover } from "./AnnotationPopover.tsx";

import type { ModelSelection } from "../../../../opencode/model-selection.ts";
import type { SessionAgentSelectionController } from "./createSessionAgentSelection.ts";
import type { SessionComposerController } from "./createSessionComposer.ts";
import type { SessionFormsController } from "./createSessionForms.ts";
import type { SessionPermissionsController } from "./createSessionPermissions.ts";
import { Composer } from "./SessionPane/Composer.tsx";
import { QuestionForm } from "../../../../ui/QuestionForm.tsx";
import { PermissionRequestCard } from "../../../../ui/PermissionRequestCard.tsx";
import { SessionPane } from "./SessionPane.tsx";
import { TranscriptView } from "./SessionPane/TranscriptView.tsx";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";

export type ConversationRegionProps = {
  readonly workspace: SessionWorkspace;
  readonly annotationDrafts: AnnotationDraftStore;
  readonly composer: SessionComposerController;
  readonly modelSelection: ModelSelection;
  readonly agentSelection: SessionAgentSelectionController;
  readonly forms: SessionFormsController;
  readonly permissions: SessionPermissionsController;
  readonly connected: () => boolean;
};

const formRenderKey = (form: { readonly sessionID: string; readonly id: string }): string =>
  `${form.sessionID}\u0000${form.id}`;

const permissionRenderKey = (request: {
  readonly sessionID: string;
  readonly id: string;
}): string => `${request.sessionID}\u0000${request.id}`;

export function ConversationRegion(props: ConversationRegionProps): JSX.Element {
  let annotationButton: HTMLButtonElement | undefined;
  const annotationUI = createTranscriptAnnotations({
    sessionID: props.workspace.selectedID,
    messages: props.workspace.transcript,
    drafts: props.annotationDrafts,
    fallbackFocus: () => annotationButton,
    enabled: () => !props.composer.disabled(),
  });
  const annotationCount = () => {
    const sessionID = props.workspace.selectedID();
    return sessionID === undefined ? 0 : props.annotationDrafts.get(sessionID).length;
  };
  const composerAction = () =>
    props.workspace.running() ? "running" : props.composer.submitting() ? "sending" : "send";
  const formKeys = createMemo(() => props.forms.sessionForms().map(formRenderKey), undefined, {
    equals: (previous, next) =>
      previous.length === next.length && previous.every((key, index) => key === next[index]),
  });
  const permissionKeys = createMemo(
    () => props.permissions.requests().map(permissionRenderKey),
    undefined,
    {
      equals: (previous, next) =>
        previous.length === next.length && previous.every((key, index) => key === next[index]),
    },
  );
  const pendingVisible = () =>
    props.permissions.state() !== "ready" ||
    props.permissions.requests().length > 0 ||
    props.forms.state() !== "ready" ||
    props.forms.sessionForms().length > 0;
  const pendingInteraction = (
    <article
      class="transcript-message transcript-assistant-message transcript-pending-interaction"
      data-message-id="session-forms"
    >
      <Show when={props.permissions.state() === "loading"}>
        <output class="transcript-state" aria-live="polite">
          <Loader class="transcript-state-loader" width={18} height={18} aria-hidden="true" />
          <span>Loading permissions</span>
        </output>
      </Show>

      <Show when={props.permissions.state() === "failed"}>
        <div class="transcript-state transcript-error-state" role="alert">
          <p>{props.permissions.error() ?? "Permissions could not be loaded."}</p>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={!props.connected()}
            onClick={() => void props.permissions.sync()}
          >
            Retry permissions
          </Button>
        </div>
      </Show>

      <For each={permissionKeys()}>
        {(permissionKey, index) => {
          const request = () =>
            props.permissions
              .requests()
              .find((item) => permissionRenderKey(item) === permissionKey);
          let root: HTMLDivElement | undefined;
          onCleanup(() => {
            const active = document.activeElement;
            const sessionID = request()?.sessionID ?? permissionKey.split("\u0000", 1)[0];
            if (
              !root ||
              !(active instanceof HTMLElement) ||
              !root.contains(active) ||
              props.workspace.selectedID() !== sessionID
            )
              return;
            const pane = root.closest<HTMLElement>(".session-pane-shell");
            queueMicrotask(() => {
              if (
                !pane?.isConnected ||
                props.workspace.selectedID() !== sessionID ||
                (document.activeElement !== document.body &&
                  document.activeElement !== document.documentElement)
              )
                return;
              const nextRequest = props.permissions.requests()[index()];
              const nextCard = nextRequest
                ? [...pane.querySelectorAll<HTMLElement>("[data-permission-request-id]")].find(
                    (card) => card.dataset.permissionRequestId === nextRequest.id,
                  )
                : undefined;
              (
                nextCard ?? pane.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')
              )?.focus({ preventScroll: true });
            });
          });
          return (
            <div
              class="permission-request-entry"
              ref={(element) => {
                root = element;
              }}
            >
              <PermissionRequestCard
                request={request()!}
                disabled={
                  !props.connected() ||
                  props.permissions.state() !== "ready" ||
                  props.permissions.pending()
                }
                submitting={props.permissions.submitting(request()!.id)}
                error={props.permissions.errorFor(request()!.id)}
                onReply={(reply) => {
                  const current = request();
                  if (current && root?.contains(document.activeElement))
                    root
                      .querySelector<HTMLElement>("[data-permission-request-id]")
                      ?.focus({ preventScroll: true });
                  if (current) void props.permissions.reply(current.id, reply);
                }}
              />
            </div>
          );
        }}
      </For>

      <Show when={props.forms.state() === "loading"}>
        <output class="transcript-state" aria-live="polite">
          <Loader class="transcript-state-loader" width={18} height={18} aria-hidden="true" />
          <span>Loading questions</span>
        </output>
      </Show>

      <Show when={props.forms.state() === "failed"}>
        <div class="transcript-state transcript-error-state" role="alert">
          <p>{props.forms.error() ?? "Questions could not be loaded."}</p>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={!props.connected()}
            onClick={() => void props.forms.sync()}
          >
            Retry
          </Button>
        </div>
      </Show>

      <For each={formKeys()}>
        {(formKey) => {
          const form = () =>
            props.forms.sessionForms().find((item) => formRenderKey(item) === formKey);
          return (
            <QuestionForm
              form={form()!}
              disabled={!props.connected()}
              submitting={props.forms.submitting(form()!.id)}
              error={props.forms.errorFor(form()!.id)}
              onSubmit={(answer) => void props.forms.reply(form()!.id, answer)}
              onCancel={() => void props.forms.cancel(form()!.id)}
            />
          );
        }}
      </For>
    </article>
  );

  return (
    <>
      <SessionPane
        selected={props.workspace.selectedSession() !== undefined}
        title={props.workspace.selectedSession()?.title}
        noSelection={
          <>
            <h2>No session selected</h2>
            <p>Select a session from the sidebar.</p>
          </>
        }
        transcript={
          <Show when={props.workspace.selectedSession()}>
            <TranscriptView
              sessionID={props.workspace.selectedID()!}
              annotationRootRef={annotationUI.attach}
              onOpenAnnotation={annotationUI.openSent}
              messages={props.workspace.transcript()}
              sessionStatus={props.workspace.transcriptStatus()}
              loading={props.workspace.transcriptLoading()}
              error={props.workspace.transcriptError()}
              onRetry={() => {
                const sessionID = props.workspace.selectedID();
                if (sessionID !== undefined) void props.workspace.hydrate(sessionID);
              }}
              pendingInteraction={pendingVisible() ? pendingInteraction : undefined}
            />
          </Show>
        }
        composer={
          <Show when={props.workspace.selectedSession()}>
            <Composer
              value={props.composer.value()}
              action={composerAction()}
              disabled={
                composerAction() === "running" ? !props.connected() : props.composer.disabled()
              }
              error={props.workspace.stopError() ?? props.composer.error()}
              review={props.composer.review()}
              annotations={
                annotationCount() > 0
                  ? {
                      count: annotationCount(),
                      ref: (button) => {
                        annotationButton = button;
                      },
                      onOpen: annotationUI.openDrafts,
                      onDiscard: annotationUI.discard,
                    }
                  : undefined
              }
              modelSelection={{
                state: props.modelSelection.state(),
                switching: props.modelSelection.switching(),
                disabled: !props.connected(),
                models: props.modelSelection.models(),
                selectedModelID: props.modelSelection.selectedModelID(),
                variants: props.modelSelection.variants(),
                selectedVariantID: props.modelSelection.selectedVariantID(),
                error: props.modelSelection.error(),
                onSelectModel: (id) => void props.modelSelection.selectModel(id),
                onSelectVariant: (id) => void props.modelSelection.selectVariant(id),
              }}
              agentSelection={{
                state: props.agentSelection.state(),
                switching: props.agentSelection.switching(),
                disabled: !props.connected(),
                agents: props.agentSelection.agents(),
                selectedAgentID: props.agentSelection.selectedAgentID(),
                error: props.agentSelection.error(),
                onSelectAgent: (id) => void props.agentSelection.selectAgent(id),
              }}
              onInput={props.composer.input}
              onSubmit={() => {
                annotationUI.close();
                void props.composer.submit();
              }}
              onStop={() => void props.workspace.stop()}
            />
          </Show>
        }
      />
      <AnnotationPopover controller={annotationUI} />
    </>
  );
}
