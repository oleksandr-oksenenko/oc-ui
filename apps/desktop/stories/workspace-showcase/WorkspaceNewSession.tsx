import {
  NewSessionScreen,
  type NewSessionScreenProps,
} from "../../src/renderer/components/App/ConnectedApp/Conversation/NewSessionScreen.tsx";
import type { NewSessionSetupProps } from "../../src/renderer/components/App/ConnectedApp/Conversation/NewSessionScreen/NewSessionSetup.tsx";
import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";

export type NewSessionDraft = {
  readonly value: string;
  readonly projectID: string;
  readonly mode: "local" | "worktree";
  readonly branch: NewSessionSetupProps["branch"];
  readonly files: readonly File[];
  readonly model: string;
  readonly variant: string;
  readonly agent: string;
};

export type WorkspaceNewSessionProps = {
  readonly draft: NewSessionDraft;
  readonly onDraftChange: (patch: Partial<NewSessionDraft>) => void;
  readonly status?: NewSessionScreenProps["status"];
  readonly empty?: boolean;
  readonly loading?: boolean;
  readonly onSubmit: (mode: "local" | "worktree") => void;
  readonly onAddProject: () => void;
};

export function WorkspaceNewSession(options: WorkspaceNewSessionProps) {
  const status = () => options.status;
  const preparing = () => status()?.kind === "preparing";
  const disabled = () => options.empty || options.loading || preparing();
  return (
    <NewSessionScreen
      setup={{
        projects: options.empty
          ? []
          : [
              { id: "oc-ui", label: "oc-ui", detail: "/Users/alex/code/oc-ui" },
              { id: "scout", label: "scout", detail: "/Users/alex/code/scout" },
              { id: "notes", label: "Notes", detail: "/Users/alex/Documents/Notes" },
            ],
        projectID: options.empty ? undefined : options.draft.projectID,
        mode: options.draft.mode,
        branch: options.draft.branch,
        branches: ["main", "feature/composer", "fix/connection-lifecycle"],
        defaultBranch: "main",
        git: options.draft.projectID !== "notes",
        loading: options.loading,
        onProjectChange: (projectID) => {
          if (projectID === "notes") {
            options.onDraftChange({
              projectID,
              mode: "local",
              branch: { kind: "existing", name: "main" },
            });
          } else {
            options.onDraftChange({ projectID });
          }
        },
        onModeChange: (mode) => {
          if (mode === "worktree" && options.draft.branch?.kind === "new") {
            options.onDraftChange({ mode, branch: { kind: "existing", name: "main" } });
          } else {
            options.onDraftChange({ mode });
          }
        },
        onBranchChange: (branch) => options.onDraftChange({ branch }),
        onAddProject: options.onAddProject,
      }}
      status={status()}
      composer={
        <Composer
          {...{
            value: options.draft.value,
            onInput: (value) => options.onDraftChange({ value }),
            files: options.draft.files,
            onAttachFiles: (incoming) =>
              options.onDraftChange({ files: [...options.draft.files, ...incoming] }),
            onRemoveFile: (file) =>
              options.onDraftChange({ files: options.draft.files.filter((item) => item !== file) }),
            onAttachText: (text) =>
              options.onDraftChange({
                files: [
                  ...options.draft.files,
                  new File([text], "pasted-text.txt", { type: "text/plain" }),
                ],
              }),
            readOnly: preparing(),
            disabled: disabled(),
            action: preparing() ? "sending" : "send",
            onSubmit: () => options.onSubmit(options.draft.mode),
            modelSelection: {
              ...composerModelSelection({
                selectedModelID: options.draft.model,
                selectedVariantID: options.draft.variant,
                onSelectModel: (model) => options.onDraftChange({ model }),
                onSelectVariant: (variant) => options.onDraftChange({ variant }),
              }),
              disabled: preparing(),
            },
            agentSelection: {
              ...composerAgentSelection({
                selectedAgentID: options.draft.agent,
                onSelectAgent: (agent) => options.onDraftChange({ agent }),
              }),
              disabled: preparing(),
            },
          }}
        />
      }
    />
  );
}
