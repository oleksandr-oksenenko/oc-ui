import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect } from "effect";

import { serverPathEntryName } from "../ui/serverPath.ts";
import type { WorkspaceOwner } from "../workspace-owner.ts";

/** Inspect a directory without resolving it as an OpenCode project. */
export const listServerDirectory = Effect.fn("listServerDirectory")(function* (
  effects: WorkspaceOwner,
  list: OpenCodeClient["file"]["list"],
  context: LocationRef,
  directory: string,
) {
  const response = yield* effects.request((signal) =>
    list(
      {
        location: { directory: context.directory, workspace: context.workspaceID },
        path: directory,
      },
      { signal },
    ),
  );
  return {
    // The response location is the request context, not the directory listed.
    context: {
      directory: response.location.directory,
      workspaceID: response.location.workspaceID,
    },
    directories: response.data
      .filter((entry) => entry.type === "directory")
      .map((entry) => serverPathEntryName(context.directory, entry.path)),
  };
});
