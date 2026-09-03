/* oxlint-disable effecttsgo/async-function */

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

const callbacks = {
  onAddProject: () => undefined,
  onProjectChange: () => undefined,
  onModeChange: () => undefined,
  onRetryProjects: () => undefined,
  onUseProject: () => undefined,
  onCreateWorktree: () => undefined,
  onRetry: () => undefined,
} satisfies Omit<NewSessionDialogProps, "state" | "mutation">;

const meta = {
  title: "Sessions/NewSessionDialog",
  component: NewSessionDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NewSessionDialog>;

export default meta;
type Story = StoryObj;
const createWorktree = fn<NewSessionDialogProps["onCreateWorktree"]>();

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
          state={{ projects, selectedProjectID: projectID(), mode: mode() }}
          onDismissBlockedChange={onDismissBlockedChange}
          {...callbacks}
          onProjectChange={setProjectID}
          onModeChange={setMode}
          onCreateWorktree={createWorktree}
        />
      )}
    </DialogStory>
  );
}

export const ChooseProjectAndLocation: Story = {
  render: () => interactiveProjectSelection(),
  play: async ({ step }) => {
    createWorktree.mockClear();
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
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
      await expect(currentDialog).toBeVisible();
      await expect(trigger).toHaveFocus();
    });

    await step("Choose a worktree and create the session", async () => {
      await userEvent.click(dialogCanvas.getByRole("radio", { name: /^Create a worktree\b/ }));
      await userEvent.click(await dialogCanvas.findByRole("button", { name: "Create worktree" }));
      await expect(createWorktree).toHaveBeenCalledOnce();
      await expect(createWorktree).toHaveBeenCalledWith();
    });
  },
};

export const WorktreeSelected = { render: () => interactiveProjectSelection("worktree") };

export const NonGitProject = {
  render: () => staticDialog({ projects, selectedProjectID: "docs", mode: "direct" }),
};

export const LoadingProjects = {
  render: () => staticDialog({ projects: [], mode: "direct", projectsLoading: true }),
};

export const ProjectsFailure = {
  render: () =>
    staticDialog({
      projects: [],
      mode: "direct",
      projectsError: "Projects could not be loaded from the server.",
    }),
};

export const NoProjectsYet = {
  render: () => staticDialog({ projects: [], mode: "direct" }),
};

export const ProjectRequired = {
  render: () =>
    staticDialog({
      projects,
      mode: "direct",
      error: { kind: "validation", message: "Choose a project." },
    }),
};

export const CreatingWorktree = {
  render: () =>
    staticDialog({ projects, selectedProjectID: "oc-ui", mode: "worktree" }, "creating-worktree"),
};

export const CreatingSession = {
  render: () =>
    staticDialog({ projects, selectedProjectID: "oc-ui", mode: "direct" }, "creating-session"),
};

export const WorktreeCreationFailure = {
  render: () =>
    staticDialog({
      projects,
      selectedProjectID: "oc-ui",
      mode: "worktree",
      error: { kind: "worktree", message: "The server could not create the worktree." },
    }),
};

export const SessionCreationFailureAfterWorktree = {
  render: () =>
    staticDialog({
      projects,
      selectedProjectID: "oc-ui",
      mode: "worktree",
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

export const LongProjectContent = {
  render: () =>
    staticDialog({
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
