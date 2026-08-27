import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import type { Meta } from "storybook-solidjs-vite";

import {
  AddProjectDialog,
  type AddProjectDialogError,
} from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionSidebar/NewSessionFlow/AddProjectDialog.tsx";
function response(directory: string, entries: readonly string[]): FileListOutput {
  return {
    location: {
      directory,
      project: { id: "project", directory, canonical: directory },
    },
    data: entries.map((path) => ({ path, type: "directory" })),
  };
}

const destinations = new Map<string, string>([
  ["/srv|projects", "/srv/projects"],
  ["/srv/projects|..", "/srv"],
  ["/srv/projects|oc-ui", "/srv/projects/oc-ui"],
  ["/srv/projects|opencode", "/srv/projects/opencode"],
  ["/srv/projects|api", "/srv/projects/api"],
  ["/srv/projects/oc-ui|..", "/srv/projects"],
  ["/srv/projects/opencode|..", "/srv/projects"],
  ["/srv/projects/api|..", "/srv/projects"],
]);

const listDirectory: OpenCodeClient["file"]["list"] = (input) => {
  const base = input?.location?.directory ?? "/";
  const target = input?.path ?? ".";
  const directory = destinations.get(`${base}|${target}`) ?? base;
  const entries =
    directory === "/srv/projects"
      ? ["oc-ui", "opencode", "api"]
      : directory === "/srv"
        ? ["projects", "worktrees"]
        : [];
  return Promise.resolve(response(directory, entries));
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

function dialog(
  options: {
    readonly initialLocation?: LocationRef;
    readonly listDirectory?: OpenCodeClient["file"]["list"];
    readonly error?: AddProjectDialogError;
    readonly adding?: boolean;
  } = {},
) {
  return (
    <AddProjectDialog
      listDirectory={options.listDirectory ?? listDirectory}
      initialLocation={options.initialLocation ?? { directory: "/srv/projects" }}
      error={options.error}
      adding={options.adding}
      onDismiss={() => undefined}
      onAddProject={() => undefined}
    />
  );
}

export const BrowseServerProjects = {
  render: () => dialog(),
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
