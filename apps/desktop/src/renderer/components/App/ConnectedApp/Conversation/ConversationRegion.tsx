import { Button } from "@opencode/ui/button";
import { Loader } from "@opencode/ui/loader";
import { For, Show, createMemo, onCleanup, type JSX } from "solid-js";

import type { AnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { createTranscriptAnnotations } from "./createTranscriptAnnotations.ts";
import { AnnotationPopover } from "./AnnotationPopover.tsx";

import type { ModelSelection } from "../../../../opencode/model-selection.ts";
import {
  serverFileImageLocation,
  type ServerFileImageReader,
} from "../../../../opencode/file-images.ts";
import { useServerRuntimeOptional } from "../../../../opencode/index.ts";
import type { SessionAgentSelectionController } from "./createSessionAgentSelection.ts";
import type { SessionComposerController } from "./createSessionComposer.ts";
import type { SessionFormsController } from "./createSessionForms.ts";
import type { SessionPermissionsController } from "../Permissions/createPermissions.ts";
import { PendingMessages } from "./SessionPane/PendingMessages.tsx";
import type { SessionInboxController } from "./createSessionInbox.ts";
import { Composer, type ComposerProps } from "./SessionPane/Composer.tsx";
import { contextUsage as deriveContextUsage } from "./SessionPane/Composer/context-usage.ts";
import { QuestionForm } from "../../../../ui/QuestionForm.tsx";
import { PermissionRequestCard } from "../../../../ui/PermissionRequestCard.tsx";
import { SessionPane } from "./SessionPane.tsx";
import { TranscriptView } from "./SessionPane/TranscriptView.tsx";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";

export type ConversationRegionProps = {
  readonly workspace: SessionWorkspace;
  readonly annotationDrafts: AnnotationDraftStore;
  readonly composer: SessionComposerController;
  readonly catalog?: ComposerProps["catalog"];
  readonly inbox: SessionInboxController;
  readonly modelSelection: ModelSelection;
  readonly agentSelection: SessionAgentSelectionController;
  readonly forms: SessionFormsController;
  readonly permissions: SessionPermissionsController;
  readonly connected: () => boolean;
  /** Host clipboard access for the composer's literal-paste escape hatch. */
  readonly readClipboardText?: () => Promise<string | undefined>;
};

const formRenderKey = (form: { readonly sessionID: string; readonly id: string }): string =>
  `${form.sessionID}\u0000${form.id}`;

const permissionRenderKey = (request: {
  readonly sessionID: string;
  readonly id: string;
}): string => `${request.sessionID}\u0000${request.id}`;

export function ConversationRegion(props: ConversationRegionProps): JSX.Element {
  const runtime = useServerRuntimeOptional();
  const visibleTranscript = createMemo(() => {
    const pending = new Set(props.inbox.messages().map((item) => item.id));
    return props.workspace.transcript().filter((message) => !pending.has(message.id));
  });
  let annotationButton: HTMLButtonElement | undefined;
  const annotationUI = createTranscriptAnnotations({
    sessionID: props.workspace.selectedID,
    messages: visibleTranscript,
    drafts: props.annotationDrafts,
    fallbackFocus: () => annotationButton,
    // Annotation work is idle-only: adding, editing and removal stay disabled
    // while a turn runs, so streaming transcript updates cannot interrupt or
    // close an editor mid-edit. Selection and copying remain available.
    enabled: () => !props.composer.disabled() && !props.workspace.running(),
  });
  const annotationCount = () => {
    const sessionID = props.workspace.selectedID();
    return sessionID === undefined ? 0 : props.annotationDrafts.get(sessionID).length;
  };
  const composerAction = () =>
    props.composer.submitting() ? "sending" : props.workspace.running() ? "running" : "send";
  const contextUsage = createMemo(() =>
    deriveContextUsage(props.workspace.transcript(), props.modelSelection.contextLimit()),
  );
  const readFileImage = createMemo<ServerFileImageReader | undefined>(() => {
    const session = props.workspace.selectedSession();
    if (runtime === undefined || session === undefined) return undefined;
    // Read the location fields so an in-place store update replaces the reader,
    // then pin a plain snapshot: worktree files resolve on the server that owns
    // them, not against the window's default location, and queued reads keep the
    // location they were requested for.
    const location = serverFileImageLocation(session.location);
    return (fileUrl) => runtime.fileImages.read(fileUrl, location);
  });
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
    props.permissions.recoveryError() !== undefined ||
    props.permissions.state() !== "ready" ||
    props.permissions.requests().length > 0 ||
    props.forms.state() !== "ready" ||
    props.forms.sessionForms().length > 0;
  const pendingInteraction = (
    <article
      class="transcript-message transcript-assistant-message transcript-pending-interaction"
      data-message-id="session-forms"
    >
      <Show when={props.permissions.recoveryError()}>
        {(error) => (
          <div class="transcript-state transcript-error-state" role="alert">
            <p>{error()}</p>
            <Button
              type="button"
              size="small"
              variant="outline"
              disabled={!props.connected()}
              onClick={() => void props.permissions.sync()}
            >
              Refresh permissions
            </Button>
          </div>
        )}
      </Show>
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
              (nextCard ?? pane.querySelector<HTMLDivElement>('[aria-label="Prompt"]'))?.focus({
                preventScroll: true,
              });
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
              readFileImage={readFileImage()}
              directory={props.workspace.selectedSession()?.location.directory}
              annotationRootRef={annotationUI.attach}
              onOpenAnnotation={annotationUI.openSent}
              messages={visibleTranscript()}
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
            <PendingMessages
              messages={props.inbox.messages()}
              disabled={
                !props.connected() ||
                props.inbox.busy() ||
                props.composer.submitting() ||
                props.workspace.transcriptLoading()
              }
              error={props.inbox.error()}
              onRefresh={props.inbox.refresh}
              onCancel={props.inbox.cancel}
              onSteer={props.inbox.steer}
            />
            <Composer
              value={props.composer.value()}
              skills={props.composer.skills()}
              catalog={props.catalog}
              command={props.composer.command()}
              sessionID={props.workspace.selectedID()}
              files={props.composer.files()}
              onAttachFiles={props.composer.attachFiles}
              onAttachText={props.composer.attachText}
              pasteRecovery={props.composer.pasteRecovery()}
              readClipboardText={props.readClipboardText}
              onRemoveFile={props.composer.removeFile}
              action={composerAction()}
              disabled={props.composer.disabled()}
              error={props.workspace.stopError() ?? props.composer.error()}
              contextUsage={contextUsage()}
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
              onQueue={() => {
                annotationUI.close();
                void props.composer.submit("queue");
              }}
              onStop={props.connected() ? () => void props.workspace.stop() : undefined}
            />
          </Show>
        }
      />
      <AnnotationPopover controller={annotationUI} />
    </>
  );
}
