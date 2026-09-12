import { Button } from "@opencode-ai/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@opencode-ai/ui/dialog";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect, createSignal, on } from "solid-js";

import type { LocationRef, Project } from "@opencode-ai/client";
import { ProjectSelection } from "./NewSessionDialog/ProjectSelection.tsx";
import "./ServerFlowDialog.css";

export type NewSessionLocationMode = "direct" | "worktree";

export type NewSessionProject = {
  readonly id: string;
  readonly name: string;
  readonly location: LocationRef;
  readonly vcs?: Project["vcs"];
};

export type NewSessionDialogError =
  | { readonly kind: "validation"; readonly message: string }
  | {
      readonly kind: "worktree";
      readonly message: string;
      readonly worktreeLocation?: LocationRef;
    }
  | {
      readonly kind: "session";
      readonly message: string;
      readonly worktreeLocation?: LocationRef;
    };

export type NewSessionDialogState = {
  readonly projects: readonly NewSessionProject[];
  readonly selectedProjectID?: string;
  readonly mode: NewSessionLocationMode;
  readonly projectsLoading?: boolean;
  readonly projectsError?: string;
  readonly error?: NewSessionDialogError;
};

export type NewSessionDialogProps = {
  readonly state: NewSessionDialogState;
  readonly mutation?: "creating-worktree" | "creating-session";
  readonly onDismissBlockedChange?: (blocked: boolean) => void;
  readonly onAddProject: () => void;
  readonly onProjectChange: (projectID: string) => void;
  readonly onModeChange: (mode: NewSessionLocationMode) => void;
  readonly onRetryProjects: () => void;
  readonly onUseProject: (projectID: string) => void;
  readonly onCreateWorktree: () => void;
  readonly onRetry: () => void;
};

function operationErrorTitle(error: NewSessionDialogError | undefined) {
  return error?.kind === "worktree" ? "Worktree creation failed" : "Session creation failed";
}

function existingWorktree(error: NewSessionDialogError | undefined) {
  return error?.kind === "worktree" || error?.kind === "session"
    ? error.worktreeLocation?.directory
    : undefined;
}

function projectSelectionUnavailable(state: NewSessionDialogState): boolean {
  return (
    state.selectedProjectID === undefined ||
    state.projectsLoading === true ||
    state.projectsError !== undefined
  );
}

function focusDialogState(
  error: NewSessionDialogError | undefined,
  projectPicker: HTMLElement | undefined,
  operationError: HTMLElement | undefined,
): void {
  if (error?.kind === "validation") {
    const trigger = projectPicker?.querySelector<HTMLElement>(".new-session-project-trigger");
    const fallback = projectPicker?.querySelector<HTMLElement>("button:not([disabled])");
    (trigger ?? fallback)?.focus();
    return;
  }
  if (error) {
    operationError?.focus();
    return;
  }
  projectPicker?.querySelector<HTMLElement>(".new-session-project-trigger")?.focus();
}

export function NewSessionDialog(props: NewSessionDialogProps) {
  const dialog = useDialog();
  let projectPicker: HTMLElement | undefined;
  let operationError: HTMLElement | undefined;
  let mutationStatus: HTMLOutputElement | undefined;
  const [submitted, setSubmitted] = createSignal(false);

  const busy = () => props.mutation !== undefined;
  const blocked = () => busy() || submitted();
  const currentError = () => props.state.error;
  const validationError = () => {
    const error = currentError();
    return error?.kind === "validation" ? error.message : undefined;
  };

  const primaryLabel = () => {
    if (props.mutation === "creating-worktree") return "Creating worktree";
    if (props.mutation === "creating-session") return "Creating session";
    const error = currentError();
    if (error?.kind === "worktree") {
      return "Close";
    }
    if (currentError()?.kind === "session") return "Retry creating session";
    return "Use project folder";
  };

  const primaryVariant = () => {
    if (busy()) return "loading" as const;
    const error = currentError();
    if (error?.kind === "session") {
      return "outline" as const;
    }
    return "contrast" as const;
  };

  const submit = (mode: NewSessionLocationMode = "direct") => {
    if (blocked() || projectSelectionUnavailable(props.state)) return;
    const state = props.state;
    const projectID = state.selectedProjectID;
    if (!projectID) return;
    if (state.error?.kind === "worktree") {
      dialog.close();
      return;
    }
    if (state.error?.kind === "session") {
      setSubmitted(true);
      props.onRetry();
      return;
    }
    if (
      mode === "worktree" &&
      state.projects.find((project) => project.id === projectID)?.vcs !== "git"
    )
      return;
    props.onModeChange(mode);
    setSubmitted(true);
    if (mode === "worktree") props.onCreateWorktree();
    else props.onUseProject(projectID);
  };

  const canCreateWorktree = () =>
    props.state.projects.find((project) => project.id === props.state.selectedProjectID)?.vcs ===
    "git";
  const recovery = () => currentError()?.kind === "session" || currentError()?.kind === "worktree";

  createEffect(() => {
    const nextError = currentError();
    const mutation = props.mutation;
    queueMicrotask(() => {
      if (mutation) mutationStatus?.focus();
      else focusDialogState(nextError, projectPicker, operationError);
    });
  });

  createEffect(
    on(
      () => [props.state, props.mutation] as const,
      () => setSubmitted(false),
      { defer: true },
    ),
  );

  createEffect(() => props.onDismissBlockedChange?.(blocked()));

  return (
    <Dialog size="normal" containerClass="server-flow-dialog new-session-dialog">
      <form
        class="server-flow-dialog-content"
        aria-busy={busy() ? "true" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogHeader closeLabel="Close new session dialog" hideClose={blocked()}>
          <DialogTitle>New session</DialogTitle>
        </DialogHeader>

        <DialogBody class="server-flow-dialog-body">
          <div class="new-session-project-row">
            <ProjectSelection
              state={props.state}
              disabled={blocked()}
              validationError={validationError()}
              onReady={(element) => {
                projectPicker = element;
              }}
              onProjectChange={props.onProjectChange}
              onRetryProjects={props.onRetryProjects}
            />
            <Button
              class="new-session-add-project"
              type="button"
              size="small"
              variant="ghost-muted"
              disabled={blocked()}
              onClick={props.onAddProject}
            >
              <Icon name="plus-small" />
              Add project
            </Button>
          </div>

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
                    <Show
                      when={currentError()?.kind === "session"}
                      fallback={<span>Inspect this retained worktree manually.</span>}
                    >
                      <span>Retry will use this worktree. It will not be deleted.</span>
                    </Show>
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
          <Show when={!blocked()}>
            <Button
              class="new-session-cancel"
              type="button"
              size="normal"
              variant="outline"
              onClick={() => dialog.close()}
            >
              Cancel
            </Button>
          </Show>
          <Show
            when={!busy() && !recovery()}
            fallback={
              <Button
                type="submit"
                size="normal"
                variant={primaryVariant()}
                disabled={blocked() || projectSelectionUnavailable(props.state)}
              >
                {primaryLabel()}
              </Button>
            }
          >
            <Button
              type="submit"
              size="normal"
              variant="outline"
              disabled={blocked() || projectSelectionUnavailable(props.state)}
            >
              Use project folder
            </Button>
            <Button
              type="button"
              size="normal"
              variant="contrast"
              disabled={
                blocked() || projectSelectionUnavailable(props.state) || !canCreateWorktree()
              }
              onClick={() => submit("worktree")}
            >
              Start in worktree
            </Button>
          </Show>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
