import { Effect, Result, Schema } from "effect";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import { isWorktreeError } from "@opencode/client";
import type { LocationRef, OpenCodeClient } from "@opencode/client";

type SessionWorktreeClient = Pick<OpenCodeClient, "location" | "worktree"> & {
  readonly vcs: Pick<OpenCodeClient["vcs"], "get">;
};

export type SessionWorktreeInput = {
  readonly effects: WorkspaceOwner;
  readonly api: SessionWorktreeClient;
  readonly isCurrent: () => boolean;
};

export class SessionWorktreeError extends Schema.TaggedError<SessionWorktreeError>()(
  "SessionWorktreeError",
  {
    message: Schema.String,
    location: Schema.optional(
      Schema.Struct({ directory: Schema.String, workspaceID: Schema.optional(Schema.String) }),
    ),
    uncertain: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  },
) {}

export type CreatedSessionWorktree = {
  readonly location: LocationRef;
};

export const createSessionWorktree = Effect.fn("createSessionWorktree")(function* (
  input: SessionWorktreeInput,
  location: LocationRef,
): Effect.fn.Return<CreatedSessionWorktree, SessionWorktreeError> {
  if (location.workspaceID) {
    return yield* new SessionWorktreeError({
      message: "Automatic worktrees are unavailable for logical workspaces.",
    });
  }
  yield* ensureCurrent(input);
  const directory = yield* resolveProject(input, location);
  yield* ensureCurrent(input);
  const vcs = yield* input.effects
    .request((signal) => input.api.vcs.get({ location: { directory: directory } }, { signal }))
    .pipe(
      Effect.mapError(
        () =>
          new SessionWorktreeError({
            message: "The default branch could not be resolved.",
          }),
      ),
    );
  const branch = vcs.data.branch.default;
  if (!branch)
    return yield* new SessionWorktreeError({
      message: "The server could not identify a default branch for this project.",
    });
  yield* ensureCurrent(input);
  const retained = yield* createNativeWorktree(input, directory, "refs/heads/" + branch);
  yield* ensureCurrent(input, retained);
  const finalLocation = yield* resolveCreatedLocation(input, retained);
  return { location: finalLocation };
});

const ensureCurrent = (input: SessionWorktreeInput, location?: LocationRef) =>
  input.isCurrent()
    ? Effect.void
    : new SessionWorktreeError({
        message: "Worktree creation was cancelled.",
        ...(location ? { location } : undefined),
      });

const resolveProject = Effect.fn("createSessionWorktree.resolveProject")(function* (
  input: SessionWorktreeInput,
  location: LocationRef,
) {
  const resolved = yield* input.effects
    .request((signal) =>
      input.api.location.get({ location: requestLocation(location) }, { signal }),
    )
    .pipe(
      Effect.mapError(
        () => new SessionWorktreeError({ message: "The project location could not be resolved." }),
      ),
    );
  if (resolved.workspaceID)
    return yield* new SessionWorktreeError({
      message: "Automatic worktrees are unavailable for logical workspaces.",
    });
  if (resolved.project.directory.trim() === "") {
    return yield* new SessionWorktreeError({
      message: "The server returned an invalid project location.",
    });
  }
  return resolved.project.directory;
});

const createNativeWorktree = Effect.fn("createSessionWorktree.createNativeWorktree")(function* (
  input: SessionWorktreeInput,
  directory: string,
  branch: string,
) {
  const created = yield* input.effects
    .request((signal) =>
      input.api.worktree.create(
        {
          location: { directory },
          strategy: "git",
          from: directory,
          branch,
        },
        { signal },
      ),
    )
    .pipe(
      Effect.mapError(({ cause }) => {
        const message = isWorktreeError(cause)
          ? cause.data.message
          : cause instanceof Error
            ? cause.message
            : "The worktree could not be created.";
        return new SessionWorktreeError({
          message: message + " A worktree may remain registered; inspect it before retrying.",
          uncertain: true,
        });
      }),
    );
  if (created.directory.trim() === "")
    return yield* new SessionWorktreeError({
      message: "The worktree was created without a directory.",
      uncertain: true,
    });
  return { directory: created.directory };
});

const resolveCreatedLocation = Effect.fn("createSessionWorktree.resolveCreatedLocation")(function* (
  input: SessionWorktreeInput,
  retained: LocationRef,
) {
  const resolved = yield* input.effects
    .request((signal) =>
      input.api.location.get({ location: requestLocation(retained) }, { signal }),
    )
    .pipe(Effect.result);
  if (Result.isFailure(resolved) || resolved.success.directory.trim() === "") {
    return yield* new SessionWorktreeError({
      message: "The worktree location could not be resolved.",
      location: retained,
    });
  }
  const finalLocation: LocationRef = { directory: resolved.success.directory };
  if (resolved.success.workspaceID !== undefined)
    finalLocation.workspaceID = resolved.success.workspaceID;
  return finalLocation;
});

const requestLocation = (location: LocationRef) => ({
  directory: location.directory,
  workspace: location.workspaceID,
});
