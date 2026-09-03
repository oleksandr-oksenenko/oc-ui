/* oxlint-disable effecttsgo/async-function */

import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  AddProjectDialog,
  type AddProjectDialogError,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/AddProjectDialog.tsx";
import { deferred } from "../src/renderer/test/deferred.ts";
import { DialogStory } from "./DialogStory.tsx";

function response(
  directory: string,
  entries: readonly string[],
  workspaceID?: string,
): FileListOutput {
  return {
    location: {
      directory,
      workspaceID,
      project: { id: "project", directory, canonical: directory },
    },
    data: entries.map((path) => ({ path, type: "directory" })),
  };
}

const listDirectory: OpenCodeClient["file"]["list"] = (input) => {
  const directory = input?.location?.directory ?? "/";
  const entries =
    directory === "/srv/projects"
      ? ["oc-ui", "opencode", "api"]
      : directory === "/srv"
        ? ["projects", "worktrees"]
        : [];
  return Promise.resolve(response(directory, entries, input?.location?.workspace));
};

// This fixture intentionally never resolves so Storybook can show the loading state.
const loadingResponse = Promise.race<FileListOutput>([]);
const loadingListDirectory: OpenCodeClient["file"]["list"] = () => loadingResponse;

const meta = {
  title: "Projects/AddProjectDialog",
  component: AddProjectDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AddProjectDialog>;

export default meta;
type Story = StoryObj;
const browseOnAddProject = fn<(location: LocationRef) => void>();
const browseStoryState = new WeakMap<Element, ReturnType<typeof deferred<FileListOutput>>>();

function dialog(
  options: {
    readonly initialLocation?: LocationRef;
    readonly listDirectory?: OpenCodeClient["file"]["list"];
    readonly error?: AddProjectDialogError;
    readonly adding?: boolean;
    readonly onAddProject?: (location: LocationRef) => void;
  } = {},
) {
  return (
    <DialogStory>
      {(onDismissBlockedChange) => (
        <AddProjectDialog
          listDirectory={options.listDirectory ?? listDirectory}
          initialLocation={options.initialLocation ?? { directory: "/srv/projects" }}
          error={options.error}
          adding={options.adding}
          onDismissBlockedChange={onDismissBlockedChange}
          onAddProject={options.onAddProject ?? (() => undefined)}
        />
      )}
    </DialogStory>
  );
}

export const BrowseServerProjects: Story = {
  render: () => {
    const childNavigation = deferred<FileListOutput>();
    return (
      <div
        data-story-fixture="browse-server-projects"
        ref={(element) => browseStoryState.set(element, childNavigation)}
      >
        {dialog({
          initialLocation: { directory: "/srv/projects", workspaceID: "workspace-1" },
          listDirectory: (input) => {
            if (input?.location?.directory === "/srv/projects/oc-ui") {
              return childNavigation.promise;
            }
            return listDirectory(input);
          },
          onAddProject: browseOnAddProject,
        })}
      </div>
    );
  },
  play: async ({ canvasElement, step }) => {
    browseOnAddProject.mockClear();
    const fixture = canvasElement.querySelector('[data-story-fixture="browse-server-projects"]');
    if (!fixture) throw new Error("Browse story fixture did not render");
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const dialogCanvas = within(currentDialog);
    await expect(canvasElement.contains(currentDialog)).toBe(false);

    await step("Keep the previous directory from being submitted while browsing", async () => {
      const childDirectory = await dialogCanvas.findByRole("button", {
        name: "Browse directory oc-ui",
      });
      await userEvent.click(childDirectory);

      const browserShell = dialogCanvas.getByRole("region", { name: "Project directory" });
      const browser = browserShell.querySelector<HTMLElement>(".server-directory-browser");
      if (!browser) throw new Error("Project directory browser did not render");
      const addProject = dialogCanvas.getByRole("button", { name: "Add project" });
      await expect(dialogCanvas.getByText("/srv/projects")).toBeVisible();
      await expect(browser).toHaveAttribute("aria-busy", "true");
      await expect(addProject).toBeDisabled();
      await expect(
        dialogCanvas.getByRole("button", { name: "Go to parent directory" }),
      ).toBeDisabled();

      const form = currentDialog.querySelector<HTMLFormElement>("form");
      if (!form) throw new Error("Add project form did not render");
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await expect(browseOnAddProject).not.toHaveBeenCalled();
    });

    await step("Add the resolved directory with its workspace identity", async () => {
      const childNavigation = browseStoryState.get(fixture);
      if (!childNavigation) throw new Error("Browse story did not create child navigation");
      childNavigation.resolve(response("/srv/projects/oc-ui", [], "workspace-1"));

      await expect(await dialogCanvas.findByText("/srv/projects/oc-ui")).toBeVisible();
      const browserShell = dialogCanvas.getByRole("region", { name: "Project directory" });
      const browser = browserShell.querySelector<HTMLElement>(".server-directory-browser");
      if (!browser) throw new Error("Project directory browser did not render");
      const addProject = dialogCanvas.getByRole("button", { name: "Add project" });
      await expect(browser).not.toHaveAttribute("aria-busy", "true");
      await expect(addProject).not.toBeDisabled();
      await userEvent.click(addProject);
      await expect(browseOnAddProject).toHaveBeenCalledOnce();
      await expect(browseOnAddProject).toHaveBeenCalledWith({
        directory: "/srv/projects/oc-ui",
        workspaceID: "workspace-1",
      });
    });
  },
};

export const DeepServerDirectory = {
  render: () => dialog({ initialLocation: { directory: "/mnt/team/experimental/service" } }),
};

export const LoadingDirectory = {
  render: () => dialog({ listDirectory: loadingListDirectory }),
};

export const DirectoryListingFailure = {
  render: () =>
    dialog({
      listDirectory: () => Promise.reject(new Error("The directory could not be loaded.")),
    }),
};

export const ValidationFailure = {
  render: () =>
    dialog({
      error: { kind: "validation", message: "This directory cannot be added as a project." },
    }),
};

export const AddProjectFailure = {
  render: () =>
    dialog({
      error: { kind: "add-project", message: "The server could not add this project." },
    }),
};

export const AddingProject = {
  render: () => dialog({ adding: true }),
};

export const NarrowDirectoryBrowser = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () =>
    dialog({
      initialLocation: {
        directory: "/mnt/team/experimental/services/renderer-infrastructure",
      },
    }),
};

export const FocusedOperationError = {
  render: () =>
    dialog({
      error: {
        kind: "add-project",
        message:
          "The server could not add the selected project directory. Check access and try again.",
      },
    }),
};
