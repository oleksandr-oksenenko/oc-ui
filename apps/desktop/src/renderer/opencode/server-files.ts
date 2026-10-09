import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect } from "effect";
import { serverPathEntryName, serverPathParent, serverPathRelative } from "../ui/serverPath.ts";
import type { WorkspaceOwner } from "../workspace-owner.ts";

/** Validate a new read root in the original context, preserving workspace identity. */
export const readServerFile = Effect.fn("readServerFile")(function* (
  input: {
    readonly fileRead: OpenCodeClient["file"]["read"];
    readonly fileList: OpenCodeClient["file"]["list"];
    readonly effects: WorkspaceOwner;
  },
  path: string,
  requested: LocationRef,
) {
  const requestLocation = { directory: requested.directory, workspace: requested.workspaceID };
  let readLocation = requestLocation;
  let readPath = path;
  if (serverPathRelative(requested.directory, path) === path) {
    const parent = serverPathParent(path);
    yield* input.effects.request((signal) =>
      input.fileList({ path: parent, location: requestLocation }, { signal }),
    );
    // response.location is the original request context, not the listed parent.
    readLocation = { ...requestLocation, directory: parent };
    readPath = serverPathEntryName(parent, path);
  }
  return yield* input.effects.request((signal) =>
    input.fileRead({ path: readPath, location: readLocation }, { signal }),
  );
});
