import { Effect, Schema } from "effect";
import type { LocationRef } from "@opencode/client";
import { runServerShell, type ShellClient } from "./server-shell.ts";
import type { WorkspaceOwner } from "../workspace-owner.ts";

class BranchReadError extends Schema.TaggedError<BranchReadError>()("BranchReadError", {
  message: Schema.String,
}) {}

/** The SDK branch list mixes local and remote names. Read local refs explicitly. */
export const readLocalBranches = (
  effects: WorkspaceOwner,
  api: ShellClient,
  location: LocationRef,
) =>
  runServerShell(
    effects,
    api,
    location,
    "git for-each-ref --format='%(refname:strip=2)' refs/heads",
  ).pipe(
    Effect.map((output) => output.split(/\r?\n/u).filter(Boolean)),
    Effect.mapError(
      () =>
        new BranchReadError({
          message: "Local branches could not be read. Check the server connection and retry.",
        }),
    ),
  );
