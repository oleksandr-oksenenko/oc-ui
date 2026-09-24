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
};

const formRenderKey = (form: { readonly sessionID: string; readonly id: string }): string =>
  `${form.sessionID}\u0000${form.id}`;

const permissionRenderKey = (request: {
  readonly sessionID: string;
  readonly id: string;
}): string => `${request.sessionID}\u0000${request.id}`;

const sameKeyList = (previous: readonly string[], next: readonly string[]): boolean =>
  previous.length === next.length && previous.every((key, index) => key === next[index]);

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
  const requestFor = (key: string) =>
    props.permissions.requests().find((item) => permissionRenderKey(item) === key);
  const formFor = (key: string) =>
    props.forms.sessionForms().find((item) => formRenderKey(item) === key);
  const isSubagentSession = (sessionID: string) =>
    props.workspace.subagentIDs().includes(sessionID);
  const ownPermissionKeys = createMemo(
    () =>
      props.permissions
        .requests()
        .filter((request) => !isSubagentSession(request.sessionID))
        .map(permissionRenderKey),
    undefined,
    { equals: sameKeyList },
  );
  const ownFormKeys = createMemo(
    () =>
      props.forms
        .sessionForms()
        .filter((form) => !isSubagentSession(form.sessionID))
        .map(formRenderKey),
    undefined,
    { equals: sameKeyList },
  );
  const renderPermissionCard = (key: string): JSX.Element => {
    const request = () => requestFor(key);
    const ownerID = key.slice(0, key.indexOf("\u0000"));
    let root: HTMLDivElement | undefined;
    onCleanup(() => {
      const active = document.activeElement;
      if (!root || !(active instanceof HTMLElement) || !root.contains(active)) return;
      const pane = root.closest<HTMLElement>(".session-pane-shell");
      const removed = root.querySelector<HTMLElement>("[data-permission-request-id]");
      const cards = pane
        ? [...pane.querySelectorAll<HTMLElement>("[data-permission-request-id]")]
        : [];
      const position = removed ? cards.indexOf(removed) : -1;
      queueMicrotask(() => {
        // The card's session must still be visible: a surviving descendant stays
        // reachable across ancestor navigation, but leaving the subtree must not
        // pull focus into the new view.
        const stillVisible =
          ownerID === props.workspace.selectedID() ||
          props.workspace.subagentIDs().includes(ownerID);
        if (
          !pane?.isConnected ||
          !stillVisible ||
          (document.activeElement !== document.body &&
            document.activeElement !== document.documentElement)
        )
          return;
        const next =
          position < 0
            ? undefined
            : [...pane.querySelectorAll<HTMLElement>("[data-permission-request-id]")][position];
        (next ?? pane.querySelector<HTMLDivElement>('[aria-label="Prompt"]'))?.focus({
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
            props.permissions.pending() ||
            (request()!.sessionID === props.workspace.selectedID() &&
              props.permissions.state() !== "ready")
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
  };
  const renderForm = (key: string): JSX.Element => {
    const form = () => formFor(key);
    return (
      <QuestionForm
        form={form()!}
        disabled={!props.connected()}
        submitting={props.forms.submitting(form()!.sessionID, form()!.id)}
        error={props.forms.errorFor(form()!.sessionID, form()!.id)}
        onSubmit={(answer) => void props.forms.reply(form()!.sessionID, form()!.id, answer)}
        onCancel={() => void props.forms.cancel(form()!.sessionID, form()!.id)}
      />
    );
  };
  const renderSubagentGroup = (sessionID: string) => {
    const permissionKeys = createMemo(
      () =>
        props.permissions
          .requests()
          .filter((request) => request.sessionID === sessionID)
          .map(permissionRenderKey),
      undefined,
      { equals: sameKeyList },
    );
    const formKeys = createMemo(
      () =>
        props.forms
          .sessionForms()
          .filter((form) => form.sessionID === sessionID)
          .map(formRenderKey),
      undefined,
      { equals: sameKeyList },
    );
    const label = createMemo(() => {
      const session = props.workspace.sessions().find((candidate) => candidate.id === sessionID);
      const detail = session?.title?.trim() || session?.agent || "Subagent";
      return `Subagent: ${detail}`;
    });
    return (
      <Show when={permissionKeys().length > 0 || formKeys().length > 0}>
        <section
          class="transcript-pending-subagent"
          data-subagent-session-id={sessionID}
          aria-labelledby={`transcript-pending-subagent-${sessionID}`}
        >
          <h3
            id={`transcript-pending-subagent-${sessionID}`}
            class="transcript-pending-subagent-title"
          >
            {label()}
          </h3>
          <For each={permissionKeys()}>{(key) => renderPermissionCard(key)}</For>
          <For each={formKeys()}>{(key) => renderForm(key)}</For>
        </section>
      </Show>
    );
  };
  const pendingVisible = () =>
    props.permissions.recoveryError() !== undefined ||
    props.permissions.subagentError() !== undefined ||
    props.forms.subagentError() !== undefined ||
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
      <Show when={props.permissions.subagentError() ?? props.forms.subagentError()}>
        {(error) => (
          <div class="transcript-state transcript-error-state" role="alert">
            <p>{error()}</p>
            <Button
              type="button"
              size="small"
              variant="outline"
              disabled={!props.connected()}
              onClick={() => {
                void props.permissions.retrySubagents();
                void props.forms.retrySubagents();
              }}
            >
              Retry subagent requests
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

      <For each={ownPermissionKeys()}>{(key) => renderPermissionCard(key)}</For>

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

      <For each={ownFormKeys()}>{(key) => renderForm(key)}</For>

      <For each={props.workspace.subagentIDs()}>
        {(sessionID) => renderSubagentGroup(sessionID)}
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
