import type { LocationRef, OpenCodeClient, Project, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";

import type { SessionCatalog } from "../../../../../../opencode/session-catalog.ts";
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
import { restoreDialogFocusAfterClose } from "../../../../../../ui/restoreDialogFocusAfterClose.ts";
import { useServerFlowDismissBlock } from "../../../../../../ui/ServerFlowDialogProvider.tsx";

export type NewSessionFlowRuntime = {
  readonly api: {
    readonly file: { readonly list: OpenCodeClient["file"]["list"] };
    readonly project: { readonly current: OpenCodeClient["project"]["current"] };
    readonly worktree: { readonly create: OpenCodeClient["worktree"]["create"] };
  };
  readonly data: {
    readonly project: {
      readonly list: Data["project"]["list"];
      readonly sync: Data["project"]["sync"];
    };
    readonly session: {
      readonly create: Data["session"]["create"];
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
  const [step, setStep] = createSignal<"select-project" | "worktree">("select-project");
  const [selectedProjectID, setSelectedProjectID] = createSignal<string>();
  const [mode, setMode] = createSignal<NewSessionLocationMode>("direct");
  const [parentLocation, setParentLocation] = createSignal<LocationRef>();
  const [selectedLocation, setSelectedLocation] = createSignal<LocationRef>();
  const [folderName, setFolderName] = createSignal("");
  const [projectsLoading, setProjectsLoading] = createSignal(true);
  const [projectsError, setProjectsError] = createSignal<string>();
  const [error, setError] = createSignal<NewSessionDialogError>();
  const [mutation, setMutation] = createSignal<"creating-worktree" | "creating-session">();
  const [addingProject, setAddingProject] = createSignal(false);
  const [addProjectError, setAddProjectError] = createSignal<AddProjectDialogError>();

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

  const worktreeProject = () => {
    const selected = selectedProject();
    return selected?.vcs === "git" ? selected : undefined;
  };

  const finalDirectory = () =>
    folderName().trim() === ""
      ? (parentLocation()?.directory ?? "")
      : worktreePathPreview(parentLocation()?.directory ?? "", folderName().trim());

  const state = createMemo<NewSessionDialogState>(() => {
    const project = worktreeProject();
    if (step() === "worktree" && project) {
      return {
        view: "worktree",
        project,
        parentLocation: parentLocation(),
        folderName: folderName(),
        finalDirectory: finalDirectory(),
        error: error(),
      };
    }
    return {
      view: "select-project",
      projects: projects(),
      selectedProjectID: selectedProjectID(),
      mode: mode(),
      projectsLoading: projectsLoading(),
      projectsError: projectsError(),
      error: error(),
    };
  });

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

  const openWorktreeForm = (projectID: string): void => {
    const project = projects().find((candidate) => candidate.id === projectID);
    if (!project || project.vcs !== "git") {
      setMode("direct");
      return;
    }
    setSelectedProjectID(projectID);
    setParentLocation(undefined);
    setFolderName("");
    setError(undefined);
    setStep("worktree");
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
    try {
      const session = await created.request;
      props.onSessionCreated(session.id);
      dialog.close();
    } catch {
      const accepted = props.runtime.data.session.get(created.id);
      if (accepted?.id === created.id) {
        props.onSessionCreated(created.id);
        dialog.close();
        return;
      }
      props.runtime.sessions.remove(created.id);
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
    const project =
      projectID === selectedProjectID()
        ? selectedProject()
        : projects().find((candidate) => candidate.id === projectID);
    if (!project) {
      setError({ kind: "validation", field: "project", message: "Choose a project." });
      return;
    }
    void createSessionAt(project, project.location);
  };

  const createWorktree = async (): Promise<void> => {
    const project = worktreeProject();
    if (!project) {
      setStep("select-project");
      setError({ kind: "validation", field: "project", message: "Choose a Git project." });
      return;
    }
    const parent = parentLocation();
    if (!parent || parent.directory.trim() === "") {
      setError({
        kind: "validation",
        field: "parent-directory",
        message: "Choose a parent directory.",
      });
      return;
    }
    const name = folderName().trim();
    if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      setError({
        kind: "validation",
        field: "folder-name",
        message: "Use one folder name without slashes.",
      });
      return;
    }

    setMutation("creating-worktree");
    setError(undefined);
    try {
      const created = await props.runtime.api.worktree.create({
        projectID: project.id,
        strategy: "git",
        from: project.location.directory,
        directory: parent.directory,
        name,
      });
      const worktreeLocation = { ...parent, directory: created.directory };
      await createSessionAt(project, worktreeLocation, worktreeLocation);
    } catch {
      setError({ kind: "worktree", message: "The worktree could not be created." });
      setMutation(undefined);
    }
  };

  const retry = (target: "worktree" | "session"): void => {
    const project = worktreeProject();
    if (!project) return;
    if (target === "worktree") {
      void createWorktree();
      return;
    }
    const current = error();
    if (current?.kind === "session" && current.worktreeLocation) {
      void createSessionAt(project, current.worktreeLocation, current.worktreeLocation);
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
      added = true;
    } catch {
      setAddProjectError({
        kind: "add-project",
        message: "The project could not be added.",
      });
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
          listDirectory={props.runtime.api.file.list}
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
          onOpenWorktreeForm={openWorktreeForm}
          onWorktreeParentChange={(location) => {
            setParentLocation(location);
            setError((current) => (current?.kind === "session" ? current : undefined));
          }}
          onWorktreeNameChange={(name) => {
            setFolderName(name);
            setError(undefined);
          }}
          onRetryProjects={() => void syncProjects()}
          onUseProject={useProject}
          onCreateWorktree={() => void createWorktree()}
          onBack={() => {
            setStep("select-project");
            setError(undefined);
          }}
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
          initialLocation={{
            ...props.runtime.defaultLocation,
            directory: inferServerHomeDirectory(props.runtime.defaultLocation.directory),
          }}
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

function worktreePathPreview(parentDirectory: string, folderName: string): string {
  if (parentDirectory === "" || folderName === "") return parentDirectory || folderName;
  const last = parentDirectory.at(-1);
  if (last === "/" || last === "\\") return `${parentDirectory}${folderName}`;
  const separator = parentDirectory.includes("\\") && !parentDirectory.includes("/") ? "\\" : "/";
  return `${parentDirectory}${separator}${folderName}`;
}

function inferServerHomeDirectory(directory: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  const normalized = directory.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment !== "");
  const first = segments[0]?.toLowerCase();

  if (isWindowsDrive(segments[0]) && segments[1]?.toLowerCase() === "users" && segments[2]) {
    return segments.slice(0, 3).join(separator);
  }
  if (!normalized.startsWith("/")) return directory;
  if ((first === "users" || first === "home") && segments[1]) {
    return `/${segments.slice(0, 2).join("/")}`;
  }
  if (first === "var" && segments[1]?.toLowerCase() === "home" && segments[2]) {
    return `/${segments.slice(0, 3).join("/")}`;
  }
  if (first === "root") return "/root";
  return directory;
}

function isWindowsDrive(segment: string | undefined): boolean {
  if (!segment || segment.length !== 2 || segment[1] !== ":") return false;
  const letter = segment.charAt(0).toLowerCase();
  return letter >= "a" && letter <= "z";
}
