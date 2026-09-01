import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createMemo, type JSX } from "solid-js";

import type { ModelSelection } from "../../../../opencode/model-selection.ts";
import type { SessionAgentSelectionController } from "./createSessionAgentSelection.ts";
import type { SessionComposerController } from "./createSessionComposer.ts";
import type { SessionFormsController } from "./createSessionForms.ts";
import { Composer } from "./SessionPane/Composer.tsx";
import { QuestionForm } from "./SessionPane/QuestionForm.tsx";
import { SessionPane } from "./SessionPane.tsx";
import { TranscriptView } from "./SessionPane/TranscriptView.tsx";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";

export type ConversationRegionProps = {
  readonly workspace: SessionWorkspace;
  readonly composer: SessionComposerController;
  readonly modelSelection: ModelSelection;
  readonly agentSelection: SessionAgentSelectionController;
  readonly forms: SessionFormsController;
  readonly connected: () => boolean;
};

const formRenderKey = (form: { readonly sessionID: string; readonly id: string }): string =>
  `${form.sessionID}\u0000${form.id}`;

export function ConversationRegion(props: ConversationRegionProps): JSX.Element {
  const composerAction = () =>
    props.workspace.running() ? "running" : props.composer.submitting() ? "sending" : "send";
  const formKeys = createMemo(() => props.forms.sessionForms().map(formRenderKey), undefined, {
    equals: (previous, next) =>
      previous.length === next.length && previous.every((key, index) => key === next[index]),
  });
  const pendingVisible = () =>
    props.forms.state() !== "ready" || props.forms.sessionForms().length > 0;
  const pendingInteraction = (
    <article
      class="transcript-message transcript-assistant-message transcript-pending-interaction"
      data-message-id="session-forms"
    >
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
            onSubmit={() => void props.composer.submit()}
            onStop={() => void props.workspace.stop()}
          />
        </Show>
      }
    />
  );
}
