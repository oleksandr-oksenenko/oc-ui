import { Show } from "solid-js";
import { TextInput } from "@opencode/ui/text-input";
import { Button } from "@opencode/ui/button";
import { NewSessionPicker } from "./NewSessionSetup/NewSessionPicker.tsx";

export type NewSessionSetupProps = {
  readonly projects: readonly {
    readonly id: string;
    readonly label: string;
    readonly detail?: string;
  }[];
  readonly projectID?: string;
  readonly mode: "local" | "worktree";
  readonly branches: readonly string[];
  readonly branch:
    | { readonly kind: "existing"; readonly name: string }
    | { readonly kind: "new"; readonly name: string };
  readonly defaultBranch: string;
  readonly git: boolean;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onProjectChange: (id: string) => void;
  readonly onModeChange: (mode: "local" | "worktree") => void;
  readonly onBranchChange: (branch: NewSessionSetupProps["branch"]) => void;
  readonly onAddProject: () => void;
};

export function NewSessionSetup(props: NewSessionSetupProps) {
  const disabled = () => props.disabled || props.loading;
  return (
    <div class="new-session-setup">
      <div class="new-session-setup-controls" role="group" aria-label="Session location">
        <NewSessionPicker
          label="Project"
          icon="folder"
          options={props.projects}
          selectedID={props.projectID}
          value={
            props.loading
              ? "Loading projects…"
              : (props.projects.find((project) => project.id === props.projectID)?.label ??
                "Choose project")
          }
          disabled={disabled()}
          onSelect={props.onProjectChange}
          action={{ label: "Add project…", onClick: props.onAddProject }}
        />
        <Show when={props.git}>
          <NewSessionPicker
            label="Location"
            icon={props.mode === "local" ? "folder" : "branch-out"}
            value={props.mode === "local" ? "Local" : "New worktree"}
            selectedID={props.mode}
            options={[
              { id: "local", label: "Local", detail: "Use the project checkout" },
              {
                id: "worktree",
                label: "New worktree",
                detail: "Start in a separate, detached checkout",
              },
            ]}
            disabled={disabled() || !props.projectID}
            onSelect={(id) => props.onModeChange(id === "local" ? "local" : "worktree")}
          />
          <NewSessionPicker
            label="Branch"
            icon="branch"
            options={props.branches.map((name) => ({ id: name, label: name }))}
            selectedID={props.branch.kind === "existing" ? props.branch.name : undefined}
            value={
              props.branch.kind === "new"
                ? props.branch.name || "New branch"
                : props.branch.name || "Choose branch"
            }
            disabled={disabled() || !props.projectID}
            onSelect={(name) => props.onBranchChange({ kind: "existing", name })}
            action={
              props.mode === "local"
                ? {
                    label: "Create new branch…",
                    onClick: () => props.onBranchChange({ kind: "new", name: "" }),
                  }
                : undefined
            }
          />
        </Show>
      </div>
      <Show when={props.git && props.mode === "local" && props.branch.kind === "new"}>
        <div class="new-session-branch-name">
          <TextInput
            aria-label="New branch name"
            placeholder="Branch name"
            value={props.branch.name}
            disabled={disabled() || !props.projectID}
            onInput={(event) =>
              props.onBranchChange({ kind: "new", name: event.currentTarget.value })
            }
          />
          <span>From {props.defaultBranch}</span>
          <Button
            variant="ghost-muted"
            size="small"
            disabled={disabled() || !props.projectID}
            onClick={() => props.onBranchChange({ kind: "existing", name: props.defaultBranch })}
          >
            Cancel
          </Button>
        </div>
      </Show>
    </div>
  );
}
