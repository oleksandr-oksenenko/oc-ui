import { Effect, Schema } from "effect";
import type { LocationRef, OpenCodeClient } from "@opencode/client";
import type { WorkspaceOwner } from "../workspace-owner.ts";

export class ServerShellError extends Schema.TaggedError<ServerShellError>()("ServerShellError", {
  message: Schema.String,
}) {}
export type ShellClient = {
  readonly config: Pick<OpenCodeClient["config"], "shells">;
  readonly shell: Pick<OpenCodeClient["shell"], "create" | "get" | "output" | "remove">;
};
export const shellArgument = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Removing a running shell cancels its server deadline without killing the process. */
export const runServerShell = Effect.fn("runServerShell")(
  function* (effects: WorkspaceOwner, api: ShellClient, location: LocationRef, command: string) {
    const shells = yield* effects.request((signal) => api.config.shells({ signal }));
    if (!shells.some((shell) => shell.acceptable))
      return yield* new ServerShellError({ message: "The server has no supported shell." });
    const created = yield* Effect.acquireRelease(
      effects.request((signal) =>
        api.shell.create(
          {
            location: { directory: location.directory, workspace: location.workspaceID },
            cwd: location.directory,
            command,
            timeout: 10_000,
          },
          { signal },
        ),
      ),
      (shell) =>
        shell.data.status === "exited"
          ? effects
              .request((signal) =>
                api.shell.remove(
                  {
                    id: shell.data.id,
                    location: {
                      directory: shell.location.directory,
                      workspace: shell.location.workspaceID,
                    },
                  },
                  { signal },
                ),
              )
              .pipe(
                Effect.catch(() =>
                  Effect.logWarning("The completed server shell could not be removed."),
                ),
              )
          : Effect.void,
    );
    const target = {
      id: created.data.id,
      location: { directory: created.location.directory, workspace: created.location.workspaceID },
    };
    while (created.data.status === "running") {
      yield* Effect.sleep("50 millis");
      created.data = (yield* effects.request((signal) => api.shell.get(target, { signal }))).data;
    }
    if (created.data.status !== "exited")
      return yield* new ServerShellError({
        message: "The server command did not finish normally. Its changes may remain.",
      });
    const output = yield* effects.request((signal) =>
      api.shell.output({ ...target, limit: 1024 * 1024 }, { signal }),
    );
    if (output.data.truncated)
      return yield* new ServerShellError({
        message: "The server command exceeded its output limit.",
      });
    if (created.data.exit !== 0)
      return yield* new ServerShellError({
        message: output.data.output.trim() || "The server command failed.",
      });
    return output.data.output;
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.mapError((error) =>
    Schema.is(ServerShellError)(error)
      ? error
      : new ServerShellError({
          message:
            "The server command could not be confirmed. Check the connection; its changes may remain.",
        }),
  ),
);
