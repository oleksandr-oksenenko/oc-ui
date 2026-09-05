import { useAtomValue } from "@effect/atom-solid";
import { Effect, Exit, Result } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../../workspace-owner.ts";
import type { LocationRef, OpenCodeClient, Project, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { showToast, toaster } from "@opencode-ai/ui/toast";
import { createEffect, createSignal, on, onCleanup } from "solid-js";

import type { SessionCatalog } from "../../../../../opencode/session-catalog.ts";
import {
  createSessionWorktree,
  type SessionWorktreeInput,
} from "../../../../../opencode/create-session-worktree.ts";
import {
  AddProjectDialog,
  type AddProjectDialogError,
} from "./NewSessionFlow/AddProjectDialog.tsx";
import {
  NewSessionDialog,
  type NewSessionDialogError,
  type NewSessionDialogState,
  type NewSessionLocationMode,
  type NewSessionProject,
} from "./NewSessionFlow/NewSessionDialog.tsx";
import { restoreDialogFocusAfterClose } from "../../../../../ui/restoreDialogFocusAfterClose.ts";
import { useServerFlowDismissBlock } from "../../../../../ui/ServerFlowDialogProvider.tsx";

type NewSessionFlowApi = SessionWorktreeInput["api"] & {
  readonly file: Pick<OpenCodeClient["file"], "list">;
  readonly project: Pick<OpenCodeClient["project"], "current">;
};

export type NewSessionFlowRuntime = {
  readonly effects: WorkspaceOwner;
  readonly api: NewSessionFlowApi;
  readonly onShellExited: SessionWorktreeInput["onShellExited"];
  readonly data: {
    readonly project: Pick<Data["project"], "list" | "sync">;
    readonly session: Pick<Data["session"], "create" | "sync"> & {
      readonly get: (sessionID: string) => SessionInfo | undefined;
    };
  };
  readonly defaultLocation: LocationRef;
  readonly sessions: {
    readonly admit: SessionCatalog["admit"];
    readonly remove: SessionCatalog["remove"];
  };
};

export type CreateNewSessionFlowInput = {
  readonly runtime: NewSessionFlowRuntime;
  readonly onDismiss: () => void;
  readonly onSessionCreated: (sessionID: string) => void;
};

/** One open creation operation, retained by the workspace across view remounts. */
export function createNewSessionFlow(props: CreateNewSessionFlowInput) {
  const [selectedProjectID, setSelectedProjectID] = createSignal<string>();
  const [mode, setMode] = createSignal<NewSessionLocationMode>("direct");
  const [selectedLocation, setSelectedLocation] = createSignal<LocationRef>();
  const effects = props.runtime.effects;
  const status = Atom.make<{
    closed?: boolean;
    dialog: "session" | "project";
    projectsLoading: boolean;
    projectsError?: string;
    error?: NewSessionDialogError;
    mutation?: "creating-worktree" | "creating-session";
    addingProject: boolean;
    addProjectError?: AddProjectDialogError;
  }>({ projectsLoading: true, addingProject: false, dialog: "session" });
  const releaseStatus = effects.mount(status);
  const current = () => effects.registry.get(status);
  const pending = () => current().mutation !== undefined || current().addingProject;
  const update = (patch: Partial<ReturnType<typeof current>>) =>
    effects.registry.set(status, { ...effects.registry.get(status), ...patch });
  const dispose = (): void => {
    update({ closed: true });
    if (!pending()) releaseStatus();
  };
  let retainedToast:
    | { readonly id: ReturnType<typeof showToast>; readonly location?: LocationRef }
    | undefined;

  const projects = (): readonly NewSessionProject[] =>
    props.runtime.data.project
      .list()
      .map((project) => projectOption(project, props.runtime.defaultLocation.workspaceID));

  const selectedProject = () => {
    const project = projects().find((candidate) => candidate.id === selectedProjectID());
    const location = selectedLocation();
    return project && location ? { ...project, location } : project;
  };

  const state = (): NewSessionDialogState => ({
    projects: projects(),
    selectedProjectID: selectedProjectID(),
    mode: mode(),
    projectsLoading: current().projectsLoading,
    projectsError: current().projectsError,
    error: current().error,
  });

  const syncProjects = Effect.fn("NewSessionFlow.syncProjects")(function* () {
    update({ projectsLoading: true, projectsError: undefined });
    const result = yield* effects
      .request(() => props.runtime.data.project.sync())
      .pipe(Effect.result);
    if (Result.isFailure(result)) {
      update({
        projectsLoading: false,
        projectsError: "Projects could not be loaded from the server.",
      });
      return;
    }
    const available = projects();
    const selected = selectedProjectID();
    if (!selected || !available.some((project) => project.id === selected)) {
      setSelectedProjectID(available[0]?.id);
      setSelectedLocation(undefined);
    }
    update({ projectsLoading: false });
  });

  effects.runFork(syncProjects());

  const changeProject = (projectID: string): void => {
    setSelectedProjectID(projectID);
    setSelectedLocation(undefined);
    if (projects().find((project) => project.id === projectID)?.vcs !== "git") setMode("direct");
    update({ error: undefined });
  };

  const showRetainedWorktreeToast = (location: LocationRef | undefined): void => {
    const id = showToast({
      title: "Worktree retained",
      description: location
        ? `The worktree remains at ${location.directory}.`
        : "A worktree may remain on the server. Inspect it manually before trying again.",
      persistent: true,
    });
    retainedToast = { id, location };
  };

  const showUncertainWorktreeToast = (location: LocationRef | undefined): void => {
    const id = showToast({
      title: "Worktree status uncertain",
      description: location
        ? `The operation could not be confirmed. Inspect ${location.directory} manually before trying again.`
        : "The operation could not be confirmed. Inspect the server manually before trying again.",
      persistent: true,
    });
    retainedToast = { id, location };
  };

  const dismissRetainedWorktreeToast = (location: LocationRef | undefined): void => {
    if (retainedToast === undefined || !sameLocation(retainedToast.location, location)) {
      return;
    }
    toaster.dismiss(retainedToast.id);
    retainedToast = undefined;
  };

  const createSessionAt = Effect.fn("NewSessionFlow.createSessionAt")(function* (
    project: NewSessionProject,
    location: LocationRef,
    worktreeLocation?: LocationRef,
  ) {
    update({ mutation: "creating-session", error: undefined });
    const created = props.runtime.data.session.create({ projectID: project.id, location });
    const reconcile = Effect.gen(function* () {
      const result = yield* effects.request(() => created.request).pipe(Effect.result);
      if (Result.isFailure(result)) {
        // A session.created event may precede hydration; reconcile before removing it.
        yield* effects
          .request(() => props.runtime.data.session.sync(created.id))
          .pipe(Effect.ignore);
        if (props.runtime.data.session.get(created.id)?.id !== created.id) {
          props.runtime.sessions.remove(created.id);
          if (worktreeLocation) showRetainedWorktreeToast(worktreeLocation);
          return undefined;
        }
      }
      props.runtime.sessions.admit(created.id);
      dismissRetainedWorktreeToast(worktreeLocation);
      return Result.isSuccess(result) ? result.success.id : created.id;
    });
    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        // The SDK owns this uncancellable request. Its settled result still needs
        // reconciliation when workspace shutdown interrupts the caller's wait.
        if (Exit.hasInterrupts(exit)) yield* reconcile;
        update({ mutation: undefined });
        if (current().closed) releaseStatus();
      }),
    );
    const sessionID = yield* reconcile;
    if (sessionID === undefined) {
      update({
        error: {
          kind: "session",
          message: worktreeLocation
            ? "The worktree exists, but its session could not be created."
            : "The session could not be created. Try again.",
          worktreeLocation,
        },
      });
      return;
    }
    update({ closed: true });
    props.onSessionCreated(sessionID);
    props.onDismiss();
  }, Effect.scoped);

  const useProject = (projectID: string): void => {
    if (current().closed || pending()) return;
    const project =
      projectID === selectedProjectID()
        ? selectedProject()
        : projects().find((candidate) => candidate.id === projectID);
    if (!project) {
      update({ error: { kind: "validation", message: "Choose a project." } });
      return;
    }
    effects.runFork(createSessionAt(project, project.location));
  };

  const createWorktree = Effect.fn("NewSessionFlow.createWorktree")(function* () {
    if (current().closed || pending()) return;
    const project = selectedProject();
    if (!project || project.vcs !== "git") {
      update({ error: { kind: "validation", message: "Choose a Git project." } });
      return;
    }
    update({ mutation: "creating-worktree", error: undefined });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        update({ mutation: undefined });
        if (current().closed) releaseStatus();
      }),
    );
    const result = yield* createSessionWorktree(
      {
        effects,
        api: props.runtime.api,
        onShellExited: props.runtime.onShellExited,
        isCurrent: () => !current().closed,
      },
      project.location,
    ).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const worktreeError = result.failure;
      if (worktreeError.uncertain) showUncertainWorktreeToast(worktreeError.location);
      else if (worktreeError.location) showRetainedWorktreeToast(worktreeError.location);
      update({
        error: {
          kind: "worktree",
          message: worktreeError.message,
          worktreeLocation: worktreeError.location,
        },
      });
      return;
    }
    const created = result.success;
    if (created.fetchError)
      showToast({
        title: "Could not update from origin.",
        description: "Using the last fetched default branch.",
        persistent: true,
      });
    yield* createSessionAt(project, created.location, created.location);
  }, Effect.scoped);

  const retry = (): void => {
    if (current().closed || pending()) return;
    const project = selectedProject();
    if (!project) return;
    const failure = current().error;
    if (failure?.kind === "session") {
      const location = failure.worktreeLocation ?? project.location;
      effects.runFork(createSessionAt(project, location, failure.worktreeLocation));
    }
  };

  const addProject = Effect.fn("NewSessionFlow.addProject")(function* (location: LocationRef) {
    if (current().closed || pending()) return;
    update({ addingProject: true, addProjectError: undefined });
    const result = yield* effects
      .request((signal) =>
        props.runtime.api.project.current(
          {
            location: { directory: location.directory, workspace: location.workspaceID },
          },
          { signal },
        ),
      )
      .pipe(
        Effect.tap(() => effects.request(() => props.runtime.data.project.sync())),
        Effect.result,
      );
    update({ addingProject: false });
    if (Result.isFailure(result)) {
      update({
        addProjectError: { kind: "add-project", message: "The project could not be added." },
      });
      return;
    }
    setSelectedProjectID(result.success.id);
    setSelectedLocation(location);
    if (projects().find((project) => project.id === result.success.id)?.vcs !== "git")
      setMode("direct");
    update({ error: undefined });
    update({ dialog: "session" });
  });

  return {
    runtime: props.runtime,
    dispose,
    status,
    state,
    current,
    useProject,
    retry,
    changeProject,
    pending,
    dismiss: () => {
      if (pending() || current().closed) return;
      dispose();
      props.onDismiss();
    },
    showSession: () => update({ dialog: "session" }),
    openAddProject: () => update({ dialog: "project" }),
    changeMode: (next: NewSessionLocationMode) => {
      if (next === "worktree" && selectedProject()?.vcs !== "git") return;
      setMode(next);
      update({ error: undefined });
    },
    syncProjects: () => {
      effects.runFork(syncProjects());
    },
    createWorktree: () => {
      effects.runFork(createWorktree());
    },
    addProject: (location: LocationRef) => {
      effects.runFork(addProject(location));
    },
  };
}

export type NewSessionFlowController = ReturnType<typeof createNewSessionFlow>;
export type NewSessionFlowProps = { readonly flow: NewSessionFlowController };

/** Binds the retained operation to this view's dialog and focus lifetime. */
export function NewSessionFlow(props: NewSessionFlowProps) {
  const flow = props.flow;
  const current = useAtomValue(() => flow.status);
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  let activeOnClose: (() => void) | undefined;
  let closingView = false;
  const showOwnedDialog = (element: Parameters<typeof dialog.show>[0], onClose: () => void) => {
    activeOnClose = onClose;
    void dialog.show(element, onClose).then(() => {
      if (closingView && dialog.active?.onClose === onClose) dialog.close();
      return undefined;
    });
  };

  createEffect(
    on(
      () => current().dialog,
      (page) => {
        setDismissBlocked(false);
        if (page === "session") {
          showOwnedDialog(
            () => (
              <NewSessionDialog
                state={{ ...flow.state(), ...current() }}
                mutation={current().mutation}
                onDismissBlockedChange={setDismissBlocked}
                onAddProject={flow.openAddProject}
                onProjectChange={flow.changeProject}
                onModeChange={flow.changeMode}
                onRetryProjects={flow.syncProjects}
                onUseProject={flow.useProject}
                onCreateWorktree={flow.createWorktree}
                onRetry={flow.retry}
              />
            ),
            () => {
              if (!closingView) flow.dismiss();
            },
          );
        } else {
          showOwnedDialog(
            () => (
              <AddProjectDialog
                effects={flow.runtime.effects}
                listDirectory={flow.runtime.api.file.list}
                initialLocation={flow.runtime.defaultLocation}
                adding={current().addingProject}
                error={current().addProjectError}
                onDismissBlockedChange={setDismissBlocked}
                onAddProject={flow.addProject}
              />
            ),
            () => {
              if (closingView) return;
              queueMicrotask(() => {
                if (closingView) return;
                flow.showSession();
                restoreDialogFocusAfterClose(() =>
                  [
                    ...document.querySelectorAll<HTMLButtonElement>("[data-dialog-layer] button"),
                  ].find((button) => button.textContent?.trim() === "Add project"),
                );
              });
            },
          );
        }
      },
    ),
  );
  createEffect(() => {
    if (current().closed && dialog.active?.onClose === activeOnClose) dialog.close();
  });
  onCleanup(() => {
    closingView = true;
    if (dialog.active?.onClose !== activeOnClose) return;
    setDismissBlocked(false);
    dialog.close();
  });
  return null;
}

function projectOption(project: Project, workspaceID?: string): NewSessionProject {
  return {
    id: project.id,
    name: project.name?.trim() || project.canonical,
    location: workspaceID
      ? { directory: project.canonical, workspaceID }
      : { directory: project.canonical },
    vcs: project.vcs,
  };
}

function sameLocation(left: LocationRef | undefined, right: LocationRef | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.directory === right.directory &&
    left.workspaceID === right.workspaceID
  );
}
