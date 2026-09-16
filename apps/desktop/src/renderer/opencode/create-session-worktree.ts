import { Deferred, Effect, Result, Schema } from "effect";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import { isWorktreeError } from "@opencode/client";
import type { LocationRef, OpenCodeClient, OpenCodeEvent } from "@opencode/client";

import prepareScript from "./worktree-scripts/prepare-worktree.sh?raw";

const SHELL_TIMEOUT_MS = 30_000;
const COMPLETION_WAIT_MS = SHELL_TIMEOUT_MS + 10_000;
const OUTPUT_PAGE_SIZE = 64 * 1024;
const MAX_OUTPUT_PAGES = 1024;
type ShellExitedEvent = Extract<OpenCodeEvent, { type: "shell.exited" }>;
type SessionWorktreeClient = Pick<OpenCodeClient, "location" | "shell" | "worktree">;

export type SessionWorktreeInput = {
  readonly effects: WorkspaceOwner;
  readonly api: SessionWorktreeClient;
  readonly onShellExited: (handler: (event: ShellExitedEvent) => void) => () => void;
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
  readonly fetchError?: string;
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
  const project = yield* resolveProject(input, location);
  if (!project.directory.startsWith("/") || project.directory.startsWith("//")) {
    return yield* new SessionWorktreeError({
      message: "Automatic worktrees require a POSIX server location.",
    });
  }
  const shellLocation = { directory: project.directory } satisfies LocationRef;
  yield* ensureCurrent(input);
  const { parent, commit, fetchError } = yield* prepareWorktree(input, shellLocation);
  yield* ensureCurrent(input);
  const retained = yield* createNativeWorktree(input, project, parent, commit);
  yield* ensureCurrent(input, retained);
  const finalLocation = yield* resolveCreatedLocation(input, retained);
  return { location: finalLocation, fetchError };
});

const ensureCurrent = (input: SessionWorktreeInput, location?: LocationRef) =>
  input.isCurrent()
    ? Effect.void
    : new SessionWorktreeError({
        message: "Worktree creation was cancelled.",
        ...(location ? { location } : undefined),
      });

type ResolvedProject = { readonly id: string; readonly directory: string };

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
  if (resolved.project.directory.trim() === "" || resolved.project.id.trim() === "") {
    return yield* new SessionWorktreeError({
      message: "The server returned an invalid project location.",
    });
  }
  return { id: resolved.project.id, directory: resolved.project.directory };
});

const prepareWorktree = Effect.fn("createSessionWorktree.prepareWorktree")(function* (
  input: SessionWorktreeInput,
  location: LocationRef,
) {
  const probe = yield* runShell(input, location, "printf 'OCUI-SHELL-PROBE\\n'");
  const shell = basename(probe.shell);
  if (!POSIX_SHELLS.has(shell)) {
    return yield* new SessionWorktreeError({
      message: "The connected server shell (" + (shell || "unknown") + ") is unsupported.",
    });
  }
  if (probe.event.data.status !== "exited" || probe.event.data.exit !== 0) {
    return yield* new SessionWorktreeError({ message: "The server shell probe failed." });
  }
  yield* ensureCurrent(input);
  const run = yield* runShell(input, location, prepareScript);
  const records = run.output.split(/\r?\n/).filter((line) => line.startsWith("OCUI1\t"));
  const completed = run.event.data.status === "exited" && run.event.data.exit === 0;
  // The first record snapshots local main; only a completed command may use the final one.
  const record = completed && records.length === 2 ? records[1] : records[0];
  const failure =
    run.event.data.status === "timeout"
      ? "Origin discovery or fetch timed out."
      : "Worktree preparation did not complete.";
  if (record === undefined) return yield* new SessionWorktreeError({ message: failure });
  const fields = record.split("\t");
  const [, encodedParent, commit, encodedDiagnostic] = fields;
  if (
    fields.length !== 4 ||
    encodedParent === undefined ||
    commit === undefined ||
    encodedDiagnostic === undefined
  ) {
    return yield* new SessionWorktreeError({
      message: "The server returned malformed worktree preparation output.",
    });
  }
  const [parent, diagnostic] = yield* Effect.try({
    try: () => [decodeHex(encodedParent), decodeHex(encodedDiagnostic)] as const,
    catch: () =>
      new SessionWorktreeError({ message: "The server returned malformed shell output." }),
  });
  const fetchError = diagnostic || (!completed || records.length !== 2 ? failure : undefined);
  if (!parent.startsWith("/") || !isCommit(commit)) {
    return yield* new SessionWorktreeError({
      message: fetchError ?? "The server returned no valid worktree destination or commit.",
    });
  }
  return { parent, commit, fetchError };
});

const createNativeWorktree = Effect.fn("createSessionWorktree.createNativeWorktree")(function* (
  input: SessionWorktreeInput,
  project: ResolvedProject,
  parent: string,
  commit: string,
) {
  const created = yield* input.effects
    .request((signal) =>
      input.api.worktree.create(
        {
          location: { directory: project.directory },
          strategy: "git",
          from: project.directory,
          directory: parent,
          branch: commit,
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

type ShellRun = {
  readonly event: ShellExitedEvent;
  readonly output: string;
  readonly shell: string;
};
const POSIX_SHELLS = new Set(["sh", "bash", "dash", "ksh", "zsh"]);

const requestLocation = (location: LocationRef) => ({
  directory: location.directory,
  workspace: location.workspaceID,
});
const basename = (shell: string): string => shell.replaceAll("\\", "/").split("/").pop() ?? shell;

const decodeHex = (hex: string): string => {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex))
    throw new SessionWorktreeError({ message: "The server returned malformed shell output." });
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};
const isCommit = (value: string): boolean => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);

const readOutput = Effect.fn("createSessionWorktree.readOutput")(function* (
  input: SessionWorktreeInput,
  shellID: string,
  location: LocationRef,
) {
  let cursor = 0;
  let output = "";
  for (let pageNumber = 0; pageNumber < MAX_OUTPUT_PAGES; pageNumber += 1) {
    const page = yield* input.effects
      .request((signal) =>
        input.api.shell.output(
          { id: shellID, location: requestLocation(location), cursor, limit: OUTPUT_PAGE_SIZE },
          { signal },
        ),
      )
      .pipe(
        Effect.mapError(({ cause }) =>
          shellFailure("The server shell output could not be collected.", cause),
        ),
      );
    if (page.data.truncated) return yield* shellFailure("The server truncated shell output.");
    output += page.data.output;
    if (page.data.cursor < cursor || page.data.cursor > page.data.size)
      return yield* shellFailure("The server returned an invalid shell output cursor.");
    if (page.data.cursor >= page.data.size) return output;
    if (page.data.cursor === cursor)
      return yield* shellFailure("The server returned shell output without progress.");
    cursor = page.data.cursor;
  }
  return yield* shellFailure("The server returned too many shell output pages.");
});

const shellFailure = (message: string, cause?: unknown) =>
  new SessionWorktreeError({
    message: cause instanceof Error ? cause.message : message,
    uncertain: true,
  });

const runShell = Effect.fn("createSessionWorktree.runShell")(function* (
  input: SessionWorktreeInput,
  location: LocationRef,
  command: string,
) {
  let shellID: string | undefined;
  let completed: ShellRun | undefined;
  const completion = yield* Deferred.make<ShellExitedEvent>();
  // Completion can arrive before shell.create returns the shell ID.
  const earlyExits = new Map<string, ShellExitedEvent>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      input.onShellExited((event) => {
        if (shellID === event.data.id) Deferred.doneUnsafe(completion, Effect.succeed(event));
        else if (shellID === undefined) earlyExits.set(event.data.id, event);
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  const run = Effect.gen(function* () {
    const created = yield* input.effects
      .request((signal) =>
        input.api.shell.create(
          {
            location: requestLocation(location),
            command,
            cwd: location.directory,
            timeout: SHELL_TIMEOUT_MS,
          },
          { signal },
        ),
      )
      .pipe(
        Effect.mapError(({ cause }) =>
          shellFailure("The server shell creation could not be confirmed.", cause),
        ),
      );
    const id = created.data.id;
    shellID = id;
    const exit = earlyExits.get(id) ?? (yield* Deferred.await(completion));
    earlyExits.clear();
    if (exit.data.status === "running")
      return yield* shellFailure("The server did not confirm shell completion.");
    const output = yield* readOutput(input, id, location);
    completed = { event: exit, output, shell: created.data.shell };
    // Removing a completed shell record is best effort and uses the same request deadline.
    yield* input.effects
      .request((signal) =>
        input.api.shell.remove({ id, location: requestLocation(location) }, { signal }),
      )
      .pipe(Effect.ignore);
    return completed;
  });
  return yield* run.pipe(
    Effect.timeoutOrElse({
      duration: COMPLETION_WAIT_MS,
      orElse: () =>
        completed
          ? Effect.succeed(completed)
          : shellFailure(
              "The server did not confirm shell completion before the request timed out.",
            ),
    }),
  );
}, Effect.scoped);
