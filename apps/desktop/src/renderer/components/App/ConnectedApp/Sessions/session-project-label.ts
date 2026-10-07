import type { Project } from "@opencode/client";
import { ProjectID } from "@opencode/schema/project-id";
import { serverPathEntryName } from "../../../../ui/serverPath.ts";

function directoryName(directory: string): string {
  const windows = /^[a-zA-Z]:[\\/]|^\\\\|^\/\//.test(directory);
  const trimmed = directory.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  // Keep filesystem roots meaningful, including drive roots and UNC shares.
  if (trimmed === "" || /^[a-zA-Z]:$/.test(trimmed)) return directory;
  return serverPathEntryName(directory, trimmed) || directory;
}

/** Presentation only: the SDK remains the owner of the project catalog. */
export function sessionProjectLabel(projectID: string | undefined, projects: readonly Project[]) {
  const project = projects.find((item) => item.id === projectID && item.id !== ProjectID.global);
  if (project) return project.name?.trim() || directoryName(project.canonical);
  return projectID === undefined ? "No project selected" : "Unknown project";
}
