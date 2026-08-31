import type { FileListOutput, OpenCodeClient } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import {
  NewSessionDialog,
  type NewSessionDialogProps,
  type NewSessionDialogState,
  type NewSessionLocationMode,
  type NewSessionProject,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/NewSessionDialog.tsx";
import { DialogStory } from "./DialogStory.tsx";

const projects = [
  {
    id: "oc-ui",
    name: "oc-ui",
    location: { directory: "/srv/projects/oc-ui" },
    vcs: "git",
  },
  {
    id: "opencode",
    name: "OpenCode",
    location: { directory: "/srv/projects/opencode" },
    vcs: "git",
  },
  {
    id: "docs",
    name: "Documentation",
    location: { directory: "/srv/projects/docs" },
  },
] as const satisfies readonly NewSessionProject[];

const listDirectory: OpenCodeClient["file"]["list"] = (input) => {
  const base = input?.location?.directory ?? "/";
  const directory =
    input?.path === ".." && base === projects[0].location.directory ? "/srv/projects" : base;
  return Promise.resolve({
    location: {
      directory,
      project: { id: "oc-ui", directory, canonical: directory },
    },
    data: [
      { path: "renderer-redesign", type: "directory" },
      { path: "server-api", type: "directory" },
    ],
  } satisfies FileListOutput);
};

const callbacks = {
  listDirectory,
  onAddProject: () => undefined,
  onProjectChange: () => undefined,
  onModeChange: () => undefined,
  onOpenWorktreeForm: () => undefined,
  onWorktreeParentChange: () => undefined,
  onWorktreeNameChange: () => undefined,
  onRetryProjects: () => undefined,
  onUseProject: () => undefined,
  onCreateWorktree: () => undefined,
  onBack: () => undefined,
  onRetry: () => undefined,
} satisfies Omit<NewSessionDialogProps, "state" | "mutation">;

const meta = {
  title: "Sessions/NewSessionDialog",
  component: NewSessionDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NewSessionDialog>;

export default meta;

function staticDialog(state: NewSessionDialogState, mutation?: NewSessionDialogProps["mutation"]) {
  return (
    <DialogStory>
      {(onDismissBlockedChange) => (
        <NewSessionDialog
          state={state}
          mutation={mutation}
          onDismissBlockedChange={onDismissBlockedChange}
          {...callbacks}
        />
      )}
    </DialogStory>
  );
}

function interactiveProjectSelection(initialMode: NewSessionLocationMode = "direct") {
  const [projectID, setProjectID] = createSignal<string | undefined>(projects[0].id);
  const [mode, setMode] = createSignal<NewSessionLocationMode>(initialMode);
  return (
    <DialogStory>
      {(onDismissBlockedChange) => (
        <NewSessionDialog
          state={{
            view: "select-project",
            projects,
            selectedProjectID: projectID(),
            mode: mode(),
          }}
          onDismissBlockedChange={onDismissBlockedChange}
          {...callbacks}
          onProjectChange={setProjectID}
          onModeChange={setMode}
        />
      )}
    </DialogStory>
  );
}

const worktreeState = {
  view: "worktree",
  project: projects[0],
  parentLocation: { directory: "/srv/worktrees" },
  folderName: "new-session-location",
  finalDirectory: "/srv/worktrees/new-session-location",
} as const satisfies NewSessionDialogState;

export const ChooseProjectAndLocation = {
  render: () => interactiveProjectSelection(),
};

export const WorktreeSelected = {
  render: () => interactiveProjectSelection("worktree"),
};

export const NonGitProject = {
  render: () =>
    staticDialog({
      view: "select-project",
      projects,
      selectedProjectID: "docs",
      mode: "direct",
    }),
};

export const LoadingProjects = {
  render: () =>
    staticDialog({ view: "select-project", projects: [], mode: "direct", projectsLoading: true }),
};

export const ProjectsFailure = {
  render: () =>
    staticDialog({
      view: "select-project",
      projects: [],
      mode: "direct",
      projectsError: "Projects could not be loaded from the server.",
    }),
};

export const NoProjectsYet = {
  render: () => staticDialog({ view: "select-project", projects: [], mode: "direct" }),
};

export const ProjectRequired = {
  render: () =>
    staticDialog({
      view: "select-project",
      projects,
      mode: "direct",
      error: { kind: "validation", field: "project", message: "Choose a project." },
    }),
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.ownerDocument.querySelector<HTMLElement>(".new-session-project-trigger")?.focus();
  },
};

export const WorktreeForm = {
  render: () => staticDialog(worktreeState),
};

export const CreatingWorktree = {
  render: () => staticDialog(worktreeState, "creating-worktree"),
};

export const CreatingSession = {
  render: () => staticDialog(worktreeState, "creating-session"),
};

export const WorktreeValidationFailure = {
  render: () =>
    staticDialog({
      ...worktreeState,
      folderName: "feature/one",
      error: { kind: "validation", field: "folder-name", message: "Use one folder name." },
    }),
};

export const WorktreeCreationFailure = {
  render: () =>
    staticDialog({
      ...worktreeState,
      error: { kind: "worktree", message: "The server could not create the worktree." },
    }),
};

export const SessionCreationFailureAfterWorktree = {
  render: () =>
    staticDialog({
      ...worktreeState,
      error: {
        kind: "session",
        message: "The worktree exists, but its session could not be created.",
        worktreeLocation: { directory: "/srv/worktrees/new-session-location" },
      },
    }),
};

export const DirectSessionCreationFailure = {
  render: () =>
    staticDialog({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
      error: { kind: "session", message: "The session could not be created. Try again." },
    }),
};

const narrowViewport = {
  options: {
    mobile390: { name: "Mobile 390x760", styles: { width: "390px", height: "760px" } },
  },
};

export const NarrowProjectSelection = {
  parameters: { viewport: narrowViewport },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  render: () => interactiveProjectSelection(),
};

export const NarrowWorktreeForm = {
  parameters: { viewport: narrowViewport },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  render: () => staticDialog(worktreeState),
};

export const LongProjectContent = {
  render: () =>
    staticDialog({
      view: "select-project",
      projects: [
        ...projects,
        {
          id: "long-project",
          name: "Renderer infrastructure and remote workspace compatibility",
          location: {
            directory:
              "/srv/projects/teams/platform/renderer-infrastructure-and-remote-workspace-compatibility",
          },
          vcs: "git",
        },
      ],
      selectedProjectID: "long-project",
      mode: "worktree",
    }),
};
