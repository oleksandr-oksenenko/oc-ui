import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { RadioGroup, RadioItem } from "@opencode-ai/ui/radio";
import { For, Show } from "solid-js";

import type { NewSessionDialogState, NewSessionLocationMode } from "../NewSessionDialog.tsx";

type ProjectSelectionState = Extract<NewSessionDialogState, { view: "select-project" }>;

export type ProjectSelectionProps = {
  readonly state: ProjectSelectionState;
  readonly disabled: boolean;
  readonly validationError?: string;
  readonly onReady: (element: HTMLElement) => void;
  readonly onAddProject: () => void;
  readonly onProjectChange: (projectID: string) => void;
  readonly onModeChange: (mode: NewSessionLocationMode) => void;
  readonly onRetryProjects: () => void;
};

export function ProjectSelection(props: ProjectSelectionProps) {
  const selectedProject = () =>
    props.state.projects.find((project) => project.id === props.state.selectedProjectID);
  const ready = () => !props.state.projectsLoading && !props.state.projectsError;

  return (
    <>
      <section ref={(element) => props.onReady(element)} class="new-session-project-picker">
        <div class="new-session-project-heading">
          <div>
            <h3>Project</h3>
            <p>Projects are directories on the connected OpenCode server.</p>
          </div>
          <Button
            type="button"
            size="small"
            variant="outline"
            disabled={props.disabled}
            onClick={props.onAddProject}
          >
            <Icon name="plus-small" />
            Add project
          </Button>
        </div>

        <Show when={props.state.projectsLoading}>
          <output class="server-directory-state">
            <Loader width={16} height={16} />
            <span>Loading projects</span>
          </output>
        </Show>

        <Show when={props.state.projectsError}>
          {(message) => (
            <div class="new-session-projects-error" role="alert">
              <span>{message()}</span>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={props.disabled}
                onClick={props.onRetryProjects}
              >
                Retry
              </Button>
            </div>
          )}
        </Show>

        <Show
          when={ready() && props.state.projects.length > 0}
          fallback={
            <Show when={ready()}>
              <div class="new-session-empty-projects">
                <Icon name="folder" />
                <span>Add a server project before creating a session.</span>
              </div>
            </Show>
          }
        >
          <RadioGroup
            label="Select a project"
            value={props.state.selectedProjectID ?? ""}
            disabled={props.disabled}
            aria-describedby={props.validationError ? "new-session-project-error" : undefined}
            aria-invalid={props.validationError ? "true" : undefined}
            onChange={props.onProjectChange}
          >
            <For each={props.state.projects}>
              {(project) => (
                <RadioItem
                  value={project.id}
                  label={project.name}
                  description={project.location.directory}
                />
              )}
            </For>
          </RadioGroup>
        </Show>

        <Show when={props.validationError}>
          {(message) => (
            <p id="new-session-project-error" class="new-session-field-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </section>

      <Show when={selectedProject()?.vcs === "git"}>
        <section class="new-session-location-choice">
          <RadioGroup
            label="Where should the session run?"
            value={props.state.mode}
            disabled={props.disabled}
            onChange={(value) => {
              if (value === "direct" || value === "worktree") props.onModeChange(value);
            }}
          >
            <RadioItem
              value="direct"
              label="Use the project directory"
              description="Commands and changes happen directly in the project directory."
            />
            <RadioItem
              value="worktree"
              label="Create a worktree"
              description="Create a separate, isolated Git worktree at the project commit."
            />
          </RadioGroup>
        </section>
      </Show>
    </>
  );
}
