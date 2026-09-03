import type { LocationRef, OpenCodeClient, Project, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { showToast, toaster } from "@opencode-ai/ui/toast";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";

import type { SessionCatalog } from "../../../../../opencode/session-catalog.ts";
import {
  createSessionWorktree,
  SessionWorktreeError,
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
  readonly api: NewSessionFlowApi;
  readonly onShellExited: SessionWorktreeInput["onShellExited"];
  readonly data: {
    readonly project: {
      readonly list: Data["project"]["list"];
      readonly sync: Data["project"]["sync"];
    };
    readonly session: {
      readonly create: Data["session"]["create"];
      readonly sync: Data["session"]["sync"];
      readonly get: (sessionID: string) => SessionInfo | undefined;
    };
  };
  readonly defaultLocation: LocationRef;
  readonly sessions: {
    readonly admit: SessionCatalog["admit"];
    readonly remove: SessionCatalog["remove"];
  };
};

export type NewSessionFlowProps = {
  readonly runtime: NewSessionFlowRuntime;
  readonly onDismiss: () => void;
  readonly onSessionCreated: (sessionID: string) => void;
};

export function NewSessionFlow(props: NewSessionFlowProps) {
  const dialog = useDialog();
  const setDismissBlocked = useServerFlowDismissBlock();
  let activeDialog = dialog.active;
  let closingFlow = false;
  const [selectedProjectID, setSelectedProjectID] = createSignal<string>();
  const [mode, setMode] = createSignal<NewSessionLocationMode>("direct");
  const [selectedLocation, setSelectedLocation] = createSignal<LocationRef>();
  const [projectsLoading, setProjectsLoading] = createSignal(true);
  const [projectsError, setProjectsError] = createSignal<string>();
  const [error, setError] = createSignal<NewSessionDialogError>();
  const [mutation, setMutation] = createSignal<"creating-worktree" | "creating-session">();
  const [addingProject, setAddingProject] = createSignal(false);
  const [addProjectError, setAddProjectError] = createSignal<AddProjectDialogError>();
  let retainedToast:
    | { readonly id: ReturnType<typeof showToast>; readonly location?: LocationRef }
    | undefined;

  const showOwnedDialog = (
    element: Parameters<typeof dialog.show>[0],
    onClose?: Parameters<typeof dialog.show>[1],
  ): void => {
    void dialog.show(element, onClose).then(() => {
      activeDialog = dialog.active;
      if (closingFlow && dialog.active === activeDialog) dialog.close();
      return undefined;
    });
  };

  onCleanup(() => {
    closingFlow = true;
    setDismissBlocked(false);
    if (dialog.active === activeDialog) dialog.close();
  });

  const projects = createMemo<readonly NewSessionProject[]>(() =>
    props.runtime.data.project
      .list()
      .map((project) => projectOption(project, props.runtime.defaultLocation.workspaceID)),
  );

  const selectedProject = () => {
    const project = projects().find((candidate) => candidate.id === selectedProjectID());
    const location = selectedLocation();
    return project && location ? { ...project, location } : project;
  };

  const state = createMemo<NewSessionDialogState>(() => ({
    projects: projects(),
    selectedProjectID: selectedProjectID(),
    mode: mode(),
    projectsLoading: projectsLoading(),
    projectsError: projectsError(),
    error: error(),
  }));

  const syncProjects = async (): Promise<void> => {
    setProjectsLoading(true);
    setProjectsError(undefined);
    try {
      await props.runtime.data.project.sync();
      const available = projects();
      const selected = selectedProjectID();
      if (!selected || !available.some((project) => project.id === selected)) {
        setSelectedProjectID(available[0]?.id);
        setSelectedLocation(undefined);
      }
    } catch {
      setProjectsError("Projects could not be loaded from the server.");
    } finally {
      setProjectsLoading(false);
    }
  };

  onMount(() => void syncProjects());

  const changeProject = (projectID: string): void => {
    setSelectedProjectID(projectID);
    setSelectedLocation(undefined);
    if (projects().find((project) => project.id === projectID)?.vcs !== "git") setMode("direct");
    setError(undefined);
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

  const createSessionAt = async (
    project: NewSessionProject,
    location: LocationRef,
    worktreeLocation?: LocationRef,
  ): Promise<void> => {
    setMutation("creating-session");
    setError(undefined);
    const created = props.runtime.data.session.create({
      projectID: project.id,
      location,
    });
    props.runtime.sessions.admit(created.id);
    const finishSession = (sessionID: string): void => {
      if (closingFlow) return;
      props.onSessionCreated(sessionID);
      dismissRetainedWorktreeToast(worktreeLocation);
      if (dialog.active === activeDialog) dialog.close();
    };
    try {
      const session = await created.request;
      finishSession(session.id);
    } catch {
      // A session.created event can arrive before its SessionInfo hydration
      // finishes. Wait for that authoritative refresh before rolling back.
      await props.runtime.data.session.sync(created.id).catch(() => undefined);
      const accepted = props.runtime.data.session.get(created.id);
      if (accepted?.id === created.id) {
        finishSession(created.id);
        return;
      }
      props.runtime.sessions.remove(created.id);
      if (worktreeLocation) showRetainedWorktreeToast(worktreeLocation);
      if (closingFlow) {
        return;
      }
      setError({
        kind: "session",
        message: worktreeLocation
          ? "The worktree exists, but its session could not be created."
          : "The session could not be created. Try again.",
        worktreeLocation,
      });
    } finally {
      setMutation(undefined);
    }
  };

  const useProject = (projectID: string): void => {
    if (closingFlow || mutation() !== undefined) return;
    const project =
      projectID === selectedProjectID()
        ? selectedProject()
        : projects().find((candidate) => candidate.id === projectID);
    if (!project) {
      setError({ kind: "validation", message: "Choose a project." });
      return;
    }
    void createSessionAt(project, project.location);
  };

  const createWorktree = async (): Promise<void> => {
    if (closingFlow || mutation() !== undefined) return;
    const project = selectedProject();
    if (!project || project.vcs !== "git") {
      setError({ kind: "validation", message: "Choose a Git project." });
      return;
    }

    setMutation("creating-worktree");
    setError(undefined);
    try {
      const created = await createSessionWorktree(
        {
          api: props.runtime.api,
          onShellExited: props.runtime.onShellExited,
          isCurrent: () => !closingFlow,
        },
        project.location,
      );
      if (created.fetchError) {
        showToast({
          title: "Could not update from origin.",
          description: "Using the last fetched default branch.",
          persistent: true,
        });
      }
      if (closingFlow) {
        showRetainedWorktreeToast(created.location);
        return;
      }
      await createSessionAt(project, created.location, created.location);
    } catch (cause) {
      const worktreeError = cause instanceof SessionWorktreeError ? cause : undefined;
      const details = worktreeError?.message ?? "The worktree could not be created.";
      const retainedLocation = worktreeError?.location;
      if (worktreeError?.uncertain) showUncertainWorktreeToast(retainedLocation);
      else if (retainedLocation) showRetainedWorktreeToast(retainedLocation);
      if (closingFlow) {
        return;
      }
      setError({
        kind: "worktree",
        message: details,
        worktreeLocation: retainedLocation,
      });
    } finally {
      setMutation(undefined);
    }
  };

  const retry = (): void => {
    if (closingFlow || mutation() !== undefined) return;
    const project = selectedProject();
    if (!project) return;
    const current = error();
    if (current?.kind === "session") {
      const location = current.worktreeLocation ?? project.location;
      void createSessionAt(project, location, current.worktreeLocation);
    }
  };

  const addProject = async (location: LocationRef): Promise<void> => {
    setAddingProject(true);
    setAddProjectError(undefined);
    let added = false;
    try {
      const current = await props.runtime.api.project.current({
        location: {
          directory: location.directory,
          workspace: location.workspaceID,
        },
      });
      await props.runtime.data.project.sync();
      setSelectedProjectID(current.id);
      setSelectedLocation(location);
      if (projects().find((project) => project.id === current.id)?.vcs !== "git") setMode("direct");
      setError(undefined);
      added = true;
    } catch {
      setAddProjectError({ kind: "add-project", message: "The project could not be added." });
    } finally {
      setAddingProject(false);
    }
    if (added && !closingFlow) showNewSessionDialog();
  };

  const showNewSessionDialog = (): void => {
    setDismissBlocked(false);
    showOwnedDialog(
      () => (
        <NewSessionDialog
          state={state()}
          mutation={mutation()}
          onDismissBlockedChange={setDismissBlocked}
          onAddProject={openAddProject}
          onProjectChange={changeProject}
          onModeChange={(next) => {
            if (next === "worktree" && selectedProject()?.vcs !== "git") return;
            setMode(next);
            setError(undefined);
          }}
          onRetryProjects={() => void syncProjects()}
          onUseProject={useProject}
          onCreateWorktree={() => void createWorktree()}
          onRetry={retry}
        />
      ),
      () => {
        if (!closingFlow) props.onDismiss();
      },
    );
  };

  const openAddProject = (): void => {
    setDismissBlocked(false);
    showOwnedDialog(
      () => (
        <AddProjectDialog
          listDirectory={props.runtime.api.file.list}
          initialLocation={props.runtime.defaultLocation}
          adding={addingProject()}
          error={addProjectError()}
          onDismissBlockedChange={setDismissBlocked}
          onAddProject={(directory) => void addProject(directory)}
        />
      ),
      () => {
        if (closingFlow) return;
        setDismissBlocked(false);
        queueMicrotask(() => {
          if (closingFlow) return;
          showNewSessionDialog();
          restoreDialogFocusAfterClose(() =>
            [...document.querySelectorAll<HTMLButtonElement>("[data-dialog-layer] button")].find(
              (button) => button.textContent?.trim() === "Add project",
            ),
          );
        });
      },
    );
  };

  onMount(showNewSessionDialog);

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
