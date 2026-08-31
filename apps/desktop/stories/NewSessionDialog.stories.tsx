/* oxlint-disable effecttsgo/async-function */

import type { FileListOutput, OpenCodeClient } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

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
type Story = StoryObj;
const chooseOnOpenWorktreeForm = fn<NewSessionDialogProps["onOpenWorktreeForm"]>();

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

function interactiveProjectSelection(
  initialMode: NewSessionLocationMode = "direct",
  onOpenWorktreeForm: NewSessionDialogProps["onOpenWorktreeForm"] = callbacks.onOpenWorktreeForm,
) {
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
          onOpenWorktreeForm={onOpenWorktreeForm}
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

export const ChooseProjectAndLocation: Story = {
  render: () => interactiveProjectSelection("direct", chooseOnOpenWorktreeForm),
  play: async ({ step }) => {
    chooseOnOpenWorktreeForm.mockClear();
    const currentDialog = await screen.findByRole("dialog", { name: "New session" });
    const dialogCanvas = within(currentDialog);
    const trigger = await dialogCanvas.findByRole("combobox", { name: "Project: oc-ui" });

    await step("Choose the OpenCode project from the portal picker", async () => {
      await userEvent.click(trigger);
      await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
      const pickerID = trigger.getAttribute("aria-controls");
      if (!pickerID) throw new Error("Project picker did not expose its content");
      const picker = document.getElementById(pickerID);
      if (!picker) throw new Error("Project picker content did not render");
      await expect(currentDialog.contains(picker)).toBe(false);

      const search = within(picker).getByPlaceholderText("Search projects");
      await expect(search).toHaveFocus();
      await userEvent.type(search, "not-a-project");
      await expect(within(picker).findByText("No matching projects.")).resolves.toBeVisible();
      await expect(picker.querySelectorAll('[data-slot="list-item"]')).toHaveLength(0);

      await userEvent.clear(search);
      await userEvent.type(search, "OpenCode");
      await waitFor(() =>
        expect(picker.querySelectorAll('[data-slot="list-item"]')).toHaveLength(1),
      );
      await userEvent.click(await within(picker).findByText("OpenCode"));
      await waitFor(() => expect(trigger).toHaveTextContent("OpenCode"));
      await expect(trigger).toHaveFocus();
    });

    await step("Verify Escape closes only the nested picker", async () => {
      await userEvent.click(trigger);
      await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
      const pickerID = trigger.getAttribute("aria-controls");
      if (!pickerID) throw new Error("Project picker did not expose its content");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
      await waitFor(() => expect(document.getElementById(pickerID)).toBeNull());
      await expect(currentDialog).toBeVisible();
      await expect(trigger).toHaveFocus();
    });

    await step("Choose a worktree and continue", async () => {
      const worktree = dialogCanvas.getByRole("radio", { name: /^Create a worktree\b/ });
      await userEvent.click(worktree);
      await userEvent.click(await dialogCanvas.findByRole("button", { name: "Continue" }));
      await expect(chooseOnOpenWorktreeForm).toHaveBeenCalledOnce();
      await expect(chooseOnOpenWorktreeForm).toHaveBeenCalledWith("opencode");
    });
  },
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
