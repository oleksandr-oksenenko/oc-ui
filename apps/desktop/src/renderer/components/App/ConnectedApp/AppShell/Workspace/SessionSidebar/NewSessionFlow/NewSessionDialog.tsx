import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect, createSignal, on } from "solid-js";

import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { createServerFlowDialog } from "./createServerFlowDialog.ts";
import { ProjectSelection } from "./NewSessionDialog/ProjectSelection.tsx";
import { WorktreeForm } from "./NewSessionDialog/WorktreeForm.tsx";
import "./ServerFlowDialog.css";

export type NewSessionLocationMode = "direct" | "worktree";

export type NewSessionProject = {
  readonly id: string;
  readonly name: string;
  readonly location: LocationRef;
  readonly vcs?: "git" | "hg";
};

export type NewSessionDialogError =
  | {
      readonly kind: "validation";
      readonly field: "project" | "parent-directory" | "folder-name";
      readonly message: string;
    }
  | { readonly kind: "worktree"; readonly message: string }
  | {
      readonly kind: "session";
      readonly message: string;
      readonly worktreeLocation?: LocationRef;
    };

export type NewSessionDialogState =
  | {
      readonly view: "select-project";
      readonly projects: readonly NewSessionProject[];
      readonly selectedProjectID?: string;
      readonly mode: NewSessionLocationMode;
      readonly projectsLoading?: boolean;
      readonly projectsError?: string;
      readonly error?: NewSessionDialogError;
    }
  | {
      readonly view: "worktree";
      readonly project: NewSessionProject;
      readonly folderName: string;
      readonly parentLocation?: LocationRef;
      readonly finalDirectory: string;
      readonly error?: NewSessionDialogError;
    };

export type NewSessionDialogProps = {
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly state: NewSessionDialogState;
  readonly mutation?: "creating-worktree" | "creating-session";
  readonly onDismiss: () => void;
  readonly onAddProject: () => void;
  readonly onProjectChange: (projectID: string) => void;
  readonly onModeChange: (mode: NewSessionLocationMode) => void;
  readonly onOpenWorktreeForm: (projectID: string) => void;
  readonly onWorktreeParentChange: (location: LocationRef) => void;
  readonly onWorktreeNameChange: (name: string) => void;
  readonly onRetryProjects: () => void;
  readonly onUseProject: (projectID: string) => void;
  readonly onCreateWorktree: () => void;
  readonly onBack: () => void;
  readonly onRetry: (target: "worktree" | "session") => void;
};

function operationErrorTitle(error: NewSessionDialogError | undefined) {
  return error?.kind === "worktree" ? "Worktree creation failed" : "Session creation failed";
}

function existingWorktree(error: NewSessionDialogError | undefined) {
  return error?.kind === "session" ? error.worktreeLocation?.directory : undefined;
}

function projectSelectionUnavailable(state: NewSessionDialogState): boolean {
  return (
    state.view === "select-project" &&
    (state.selectedProjectID === undefined ||
      state.projectsLoading === true ||
      state.projectsError !== undefined)
  );
}

function dispatchSubmit(props: NewSessionDialogProps, state: NewSessionDialogState): void {
  const projectID = state.view === "select-project" ? state.selectedProjectID : state.project.id;
  if (!projectID) return;

  if (state.view === "worktree" && state.error?.kind === "worktree") {
    props.onRetry("worktree");
    return;
  }
  if (state.view === "worktree" && state.error?.kind === "session") {
    props.onRetry("session");
    return;
  }
  if (state.view === "worktree") {
    props.onCreateWorktree();
    return;
  }
  if (state.mode === "worktree") props.onOpenWorktreeForm(projectID);
  else props.onUseProject(projectID);
}

function focusDialogState(
  view: NewSessionDialogState["view"],
  error: NewSessionDialogError | undefined,
  elements: {
    readonly projectPicker?: HTMLElement;
    readonly parentBrowser?: HTMLElement;
    readonly nameInput?: HTMLInputElement;
    readonly operationError?: HTMLElement;
  },
): void {
  if (error?.kind === "validation") {
    if (error.field === "project") {
      const radio = elements.projectPicker?.querySelector<HTMLElement>(
        '[data-slot="radio-v2-item-input"]',
      );
      const fallback = elements.projectPicker?.querySelector<HTMLElement>("button:not([disabled])");
      (radio ?? fallback)?.focus();
      return;
    }
    const targets = {
      "parent-directory": elements.parentBrowser,
      "folder-name": elements.nameInput,
    };
    targets[error.field]?.focus();
    return;
  }
  if (error) {
    elements.operationError?.focus();
    return;
  }
  if (view === "worktree") {
    elements.parentBrowser?.focus();
    return;
  }
  elements.projectPicker?.querySelector<HTMLElement>('[data-slot="radio-v2-item-input"]')?.focus();
}

export function NewSessionDialog(props: NewSessionDialogProps) {
  let projectPicker: HTMLElement | undefined;
  let parentBrowser: HTMLElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let operationError: HTMLElement | undefined;
  let submitted = false;
  const [parentBrowserLoading, setParentBrowserLoading] = createSignal(false);

  const busy = () => props.mutation !== undefined;
  const { ref: dialogRef, dismiss } = createServerFlowDialog({
    blocked: () => busy() || submitted,
    onDismiss: props.onDismiss,
  });
  const currentError = () => props.state.error;
  const worktreeInputsDisabled = () => busy() || existingWorktree(currentError()) !== undefined;
  const validationError = (
    field: Extract<NewSessionDialogError, { kind: "validation" }>["field"],
  ) => {
    const error = currentError();
    return error?.kind === "validation" && error.field === field ? error.message : undefined;
  };

  const primaryLabel = () => {
    if (props.mutation === "creating-worktree") return "Creating worktree";
    if (props.mutation === "creating-session") return "Creating session";
    if (currentError()?.kind === "worktree") return "Retry creating worktree";
    if (currentError()?.kind === "session") return "Retry creating session";
    if (props.state.view === "worktree") return "Create worktree";
    if (props.state.mode === "worktree") return "Continue";
    return "Create session";
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (
      busy() ||
      projectSelectionUnavailable(props.state) ||
      (props.state.view === "worktree" && parentBrowserLoading()) ||
      submitted
    )
      return;

    const state = props.state;
    const projectID = state.view === "select-project" ? state.selectedProjectID : state.project.id;
    if (!projectID) return;
    submitted = true;
    dispatchSubmit(props, state);
  };

  const goBack = () => {
    if (!busy() && !submitted) props.onBack();
  };

  createEffect(() => {
    const view = props.state.view;
    const nextError = currentError();
    queueMicrotask(() => {
      focusDialogState(view, nextError, {
        projectPicker,
        parentBrowser,
        nameInput,
        operationError,
      });
    });
  });

  createEffect(
    on(
      () => [props.state, props.mutation] as const,
      () => {
        submitted = false;
      },
      { defer: true },
    ),
  );

  return (
    <dialog
      ref={dialogRef}
      class="server-flow-dialog"
      aria-labelledby="new-session-dialog-title"
      aria-describedby="new-session-dialog-description"
      aria-busy={busy() ? "true" : undefined}
    >
      <form class="server-flow-dialog-content" onSubmit={submit}>
        <header class="server-flow-dialog-header">
          <div>
            <h2 id="new-session-dialog-title">
              {props.state.view === "worktree" ? "Create a worktree" : "New session"}
            </h2>
            <p id="new-session-dialog-description">
              {props.state.view === "worktree"
                ? "Choose where the server should create the isolated worktree."
                : "Choose a project and where its session should run."}
            </p>
          </div>
          <Show when={!busy()}>
            <Button
              type="button"
              size="small"
              variant="ghost-muted"
              icon="xmark-small"
              aria-label="Close new session dialog"
              onClick={dismiss}
            />
          </Show>
        </header>

        <div class="server-flow-dialog-body">
          <Show when={props.state.view === "select-project" ? props.state : undefined}>
            {(state) => (
              <ProjectSelection
                state={state()}
                disabled={busy()}
                validationError={validationError("project")}
                onReady={(element) => {
                  projectPicker = element;
                }}
                onAddProject={props.onAddProject}
                onProjectChange={props.onProjectChange}
                onModeChange={props.onModeChange}
                onRetryProjects={props.onRetryProjects}
              />
            )}
          </Show>

          <Show when={props.state.view === "worktree" ? props.state : undefined}>
            {(state) => (
              <WorktreeForm
                listDirectory={props.listDirectory}
                state={state()}
                disabled={worktreeInputsDisabled()}
                parentValidationError={validationError("parent-directory")}
                nameValidationError={validationError("folder-name")}
                onBrowserReady={(element) => {
                  parentBrowser = element;
                }}
                onBrowserLoadingChange={setParentBrowserLoading}
                onNameReady={(element) => {
                  nameInput = element;
                }}
                onParentChange={props.onWorktreeParentChange}
                onNameChange={props.onWorktreeNameChange}
              />
            )}
          </Show>

          <Show when={currentError() && currentError()?.kind !== "validation"}>
            <section
              ref={(element: HTMLElement) => {
                operationError = element;
              }}
              class="server-flow-operation-error"
              role="alert"
              tabIndex={-1}
            >
              <Icon name="warning" />
              <div>
                <strong>{operationErrorTitle(currentError())}</strong>
                <p>{currentError()?.message}</p>
                <Show when={existingWorktree(currentError())}>
                  <div class="new-session-existing-worktree">
                    <span>Created worktree</span>
                    <code>{existingWorktree(currentError())}</code>
                    <span>Retry will use this worktree. It will not be deleted.</span>
                  </div>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={busy()}>
            <output class="server-flow-mutation-status" aria-live="polite">
              <Loader width={18} height={18} />
              <span>{primaryLabel()}</span>
            </output>
          </Show>
        </div>

        <footer class="server-flow-dialog-footer">
          <Show
            when={!busy() && props.state.view === "worktree"}
            fallback={
              <Show when={!busy()}>
                <Button type="button" size="large" variant="ghost" onClick={dismiss}>
                  Cancel
                </Button>
              </Show>
            }
          >
            <Button type="button" size="large" variant="ghost" onClick={goBack}>
              Back
            </Button>
          </Show>
          <Button
            type="submit"
            size="large"
            variant={busy() ? "loading" : "contrast"}
            disabled={
              busy() ||
              (props.state.view === "worktree" && parentBrowserLoading()) ||
              projectSelectionUnavailable(props.state)
            }
          >
            <Show when={busy()}>
              <Loader width={16} height={16} />
            </Show>
            {primaryLabel()}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
