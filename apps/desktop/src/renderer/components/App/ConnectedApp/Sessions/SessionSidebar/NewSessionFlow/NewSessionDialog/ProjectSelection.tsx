import { Popover as Kobalte } from "@kobalte/core/popover";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { List } from "@opencode-ai/ui/list";
import { Loader } from "@opencode-ai/ui/loader";
import { RadioGroup, RadioItem } from "@opencode-ai/ui/radio";
import { Show, createEffect, createMemo, createSignal, createUniqueId } from "solid-js";

import type { NewSessionDialogState, NewSessionLocationMode } from "../NewSessionDialog.tsx";

type ProjectSelectionState = Extract<NewSessionDialogState, { view: "select-project" }>;
type ProjectOption = {
  readonly project: ProjectSelectionState["projects"][number];
  readonly name: string;
  readonly search: string;
};

function projectDisplayName(project: ProjectOption["project"]): string {
  if (project.name !== project.location.directory) return project.name;
  const normalized = project.location.directory.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || project.name;
}

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
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const pickerContentID = `new-session-project-${createUniqueId()}`;
  const projectOptions = createMemo<ProjectOption[]>(() =>
    props.state.projects.map((project) => {
      const name = projectDisplayName(project);
      return {
        project,
        name,
        search: `${name}\n${project.name}\n${project.location.directory}`,
      };
    }),
  );
  const selectedOption = () =>
    projectOptions().find(({ project }) => project.id === props.state.selectedProjectID);
  const selectedProject = () => selectedOption()?.project;
  const ready = () => !props.state.projectsLoading && !props.state.projectsError;

  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger()?.focus());
  };
  const selectProject = (option: ProjectOption | undefined) => {
    if (!option) return;
    props.onProjectChange(option.project.id);
    closePicker();
  };

  createEffect(() => {
    if (props.disabled) closePicker();
  });

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
          <Kobalte
            open={pickerOpen()}
            onOpenChange={(open) => setPickerOpen(open)}
            placement="bottom-start"
            gutter={4}
            sameWidth
            fitViewport
            modal
            forceMount
          >
            <Kobalte.Trigger
              ref={setTrigger}
              as="button"
              type="button"
              role="combobox"
              class="new-session-project-trigger"
              disabled={props.disabled}
              aria-label={`Project: ${selectedOption()?.name ?? "Select a project"}`}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen()}
              aria-controls={pickerOpen() ? pickerContentID : undefined}
              aria-describedby={props.validationError ? "new-session-project-error" : undefined}
              aria-invalid={props.validationError ? "true" : undefined}
              data-server-flow-escape-trigger
            >
              <span class="new-session-project-trigger-value">
                <strong>{selectedOption()?.name ?? "Select a project"}</strong>
                <Show when={selectedProject()?.location.directory}>
                  {(directory) => <span>{directory()}</span>}
                </Show>
              </span>
              <Icon name="chevron-down" size="small" />
            </Kobalte.Trigger>

            <Kobalte.Portal>
              <Show when={pickerOpen()}>
                <Kobalte.Content
                  id={pickerContentID}
                  class="new-session-project-popover"
                  onEscapeKeyDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closePicker(true);
                  }}
                  onPointerDownOutside={() => closePicker()}
                >
                  <Kobalte.Title class="sr-only">Select a project</Kobalte.Title>
                  <List
                    class="new-session-project-list"
                    search={{ placeholder: "Search projects", autofocus: true }}
                    emptyMessage="No matching projects."
                    items={projectOptions()}
                    key={(option) => option.project.id}
                    current={selectedOption()}
                    filterKeys={["search"]}
                    onSelect={selectProject}
                  >
                    {({ project, name }) => (
                      <span class="new-session-project-option">
                        <strong>{name}</strong>
                        <span>{project.location.directory}</span>
                      </span>
                    )}
                  </List>
                </Kobalte.Content>
              </Show>
            </Kobalte.Portal>
          </Kobalte>
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
