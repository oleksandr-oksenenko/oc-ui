import type { JSX } from "solid-js";
import { Show } from "solid-js";

import type { ModelSelection } from "../../../../opencode/model-selection.ts";
import type { SessionAgentSelectionController } from "./createSessionAgentSelection.ts";
import type { SessionComposerController } from "./createSessionComposer.ts";
import { Composer } from "./SessionPane/Composer.tsx";
import { SessionPane } from "./SessionPane.tsx";
import { TranscriptView } from "./SessionPane/TranscriptView.tsx";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";

export type ConversationRegionProps = {
  readonly workspace: SessionWorkspace;
  readonly composer: SessionComposerController;
  readonly modelSelection: ModelSelection;
  readonly agentSelection: SessionAgentSelectionController;
  readonly connected: () => boolean;
};

export function ConversationRegion(props: ConversationRegionProps): JSX.Element {
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
          />
        </Show>
      }
      composer={
        <Show when={props.workspace.selectedSession()}>
          <Composer
            value={props.composer.value()}
            disabled={props.composer.disabled()}
            submitting={props.composer.submitting()}
            running={props.workspace.running()}
            error={props.composer.error()}
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
          />
        </Show>
      }
    />
  );
}
