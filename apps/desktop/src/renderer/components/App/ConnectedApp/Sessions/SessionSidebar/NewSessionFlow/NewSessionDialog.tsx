import { Button } from "@opencode-ai/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode-ai/ui/dialog";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect, createSignal, on } from "solid-js";

import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
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
  readonly onDismissBlockedChange?: (blocked: boolean) => void;
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
      const trigger = elements.projectPicker?.querySelector<HTMLElement>(
        ".new-session-project-trigger",
      );
      const fallback = elements.projectPicker?.querySelector<HTMLElement>("button:not([disabled])");
      (trigger ?? fallback)?.focus();
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
  elements.projectPicker?.querySelector<HTMLElement>(".new-session-project-trigger")?.focus();
}

export function NewSessionDialog(props: NewSessionDialogProps) {
  const dialog = useDialog();
  let projectPicker: HTMLElement | undefined;
  let parentBrowser: HTMLElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let operationError: HTMLElement | undefined;
  let mutationStatus: HTMLOutputElement | undefined;
  const [submitted, setSubmitted] = createSignal(false);
  const [parentBrowserLoading, setParentBrowserLoading] = createSignal(false);

  const busy = () => props.mutation !== undefined;
  const blocked = () => busy() || submitted();
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

  const primaryVariant = () => {
    if (busy()) return "loading" as const;
    if (currentError()?.kind === "worktree" || currentError()?.kind === "session") {
      return "outline" as const;
    }
    return "contrast" as const;
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (
      busy() ||
      projectSelectionUnavailable(props.state) ||
      (props.state.view === "worktree" && parentBrowserLoading()) ||
      submitted()
    )
      return;

    const state = props.state;
    const projectID = state.view === "select-project" ? state.selectedProjectID : state.project.id;
    if (!projectID) return;
    setSubmitted(true);
    dispatchSubmit(props, state);
  };

  const goBack = () => {
    if (!blocked()) props.onBack();
  };

  createEffect(() => {
    const view = props.state.view;
    const nextError = currentError();
    const mutation = props.mutation;
    queueMicrotask(() => {
      if (mutation) mutationStatus?.focus();
      else
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
        setSubmitted(false);
      },
      { defer: true },
    ),
  );

  createEffect(() => props.onDismissBlockedChange?.(blocked()));

  return (
    <Dialog size="large" containerClass="server-flow-dialog">
      <form
        class="server-flow-dialog-content"
        aria-busy={busy() ? "true" : undefined}
        onSubmit={submit}
      >
        <DialogHeader closeLabel="Close new session dialog" hideClose={blocked()}>
          <DialogTitleGroup
            title={props.state.view === "worktree" ? "Create a worktree" : "New session"}
            description={
              props.state.view === "worktree"
                ? "Choose where the server should create the isolated worktree."
                : "Choose a project and where its session should run."
            }
          />
        </DialogHeader>

        <DialogBody class="server-flow-dialog-body">
          <Show when={props.state.view === "select-project" ? props.state : undefined}>
            {(state) => (
              <ProjectSelection
                state={state()}
                disabled={blocked()}
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
            <output
              ref={(element) => {
                mutationStatus = element;
              }}
              class="server-flow-mutation-status"
              aria-live="polite"
              tabIndex={-1}
            >
              <Loader width={18} height={18} />
              <span>{primaryLabel()}</span>
            </output>
          </Show>
        </DialogBody>

        <DialogFooter>
          <Show
            when={!blocked() && props.state.view === "worktree"}
            fallback={
              <Show when={!blocked()}>
                <Button
                  type="button"
                  size="normal"
                  variant="outline"
                  onClick={() => dialog.close()}
                >
                  Cancel
                </Button>
              </Show>
            }
          >
            <Button type="button" size="normal" variant="outline" onClick={goBack}>
              Back
            </Button>
          </Show>
          <Button
            type="submit"
            size="normal"
            variant={primaryVariant()}
            disabled={
              blocked() ||
              (props.state.view === "worktree" && parentBrowserLoading()) ||
              projectSelectionUnavailable(props.state)
            }
          >
            <Show when={busy()}>
              <Loader width={16} height={16} />
            </Show>
            {primaryLabel()}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
