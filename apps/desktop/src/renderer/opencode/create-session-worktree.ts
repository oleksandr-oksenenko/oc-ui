import { isWorktreeError } from "@opencode-ai/client";
import type { LocationRef, OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client";

import prepareScript from "./worktree-scripts/prepare-worktree.sh?raw";

const SHELL_TIMEOUT_MS = 30_000;
const COMPLETION_WAIT_MS = SHELL_TIMEOUT_MS + 10_000;
const OUTPUT_PAGE_SIZE = 64 * 1024;
const MAX_OUTPUT_PAGES = 1024;
type ShellExitedEvent = Extract<OpenCodeEvent, { type: "shell.exited" }>;
type SessionWorktreeClient = {
  readonly location: OpenCodeClient["location"];
  readonly shell: OpenCodeClient["shell"];
  readonly worktree: OpenCodeClient["worktree"];
};

export type SessionWorktreeInput = {
  readonly api: SessionWorktreeClient;
  readonly onShellExited: (handler: (event: ShellExitedEvent) => void) => () => void;
  readonly isCurrent: () => boolean;
};

export class SessionWorktreeError extends Error {
  readonly location?: LocationRef;
  readonly uncertain: boolean;
  constructor(
    message: string,
    options?: { readonly location?: LocationRef; readonly uncertain?: boolean },
  ) {
    super(message);
    this.name = "SessionWorktreeError";
    this.location = options?.location;
    this.uncertain = options?.uncertain ?? false;
  }
}

export type CreatedSessionWorktree = {
  readonly location: LocationRef;
  readonly fetchError?: string;
};

export async function createSessionWorktree(
  input: SessionWorktreeInput,
  location: LocationRef,
): Promise<CreatedSessionWorktree> {
  if (location.workspaceID) {
    throw new SessionWorktreeError("Automatic worktrees are unavailable for logical workspaces.");
  }
  ensureCurrent(input);
  const project = await resolveProject(input, location);
  if (!project.directory.startsWith("/") || project.directory.startsWith("//")) {
    throw new SessionWorktreeError("Automatic worktrees require a POSIX server location.");
  }
  const shellLocation = { directory: project.directory } satisfies LocationRef;
  ensureCurrent(input);
  const { parent, commit, fetchError } = await prepareWorktree(input, shellLocation);
  ensureCurrent(input);
  const retained = await createNativeWorktree(input, project, parent, commit);
  ensureCurrent(input, retained);
  const finalLocation = await resolveCreatedLocation(input, retained);
  return { location: finalLocation, fetchError };
}

const ensureCurrent = (input: SessionWorktreeInput, location?: LocationRef): void => {
  if (!input.isCurrent())
    throw new SessionWorktreeError(
      "Worktree creation was cancelled.",
      location ? { location } : undefined,
    );
};

type ResolvedProject = { readonly id: string; readonly directory: string };

const resolveProject = async (
  input: SessionWorktreeInput,
  location: LocationRef,
): Promise<ResolvedProject> => {
  try {
    const resolved = await input.api.location.get({ location: requestLocation(location) });
    if (resolved.workspaceID) {
      throw new SessionWorktreeError("Automatic worktrees are unavailable for logical workspaces.");
    }
    if (resolved.project.directory.trim() === "" || resolved.project.id.trim() === "") {
      throw new SessionWorktreeError("The server returned an invalid project location.");
    }
    return { id: resolved.project.id, directory: resolved.project.directory };
  } catch (cause) {
    if (cause instanceof SessionWorktreeError) throw cause;
    throw new SessionWorktreeError("The project location could not be resolved.");
  }
};

const prepareWorktree = async (
  input: SessionWorktreeInput,
  location: LocationRef,
): Promise<{ readonly parent: string; readonly commit: string; readonly fetchError?: string }> => {
  const probe = await runShell(input, location, "printf 'OCUI-SHELL-PROBE\\n'");
  const shell = basename(probe.shell);
  if (!POSIX_SHELLS.has(shell)) {
    throw new SessionWorktreeError(
      "The connected server shell (" + (shell || "unknown") + ") is unsupported.",
    );
  }
  if (probe.event.data.status !== "exited" || probe.event.data.exit !== 0) {
    throw new SessionWorktreeError("The server shell probe failed.");
  }
  ensureCurrent(input);
  const run = await runShell(input, location, prepareScript);
  const records = run.output.split(/\r?\n/).filter((line) => line.startsWith("OCUI1\t"));
  const completed = run.event.data.status === "exited" && run.event.data.exit === 0;
  // The first record is the pre-fetch snapshot; only a completed command may use the final one.
  const record = completed && records.length === 2 ? records[1] : records[0];
  const failure =
    run.event.data.status === "timeout"
      ? "Origin discovery or fetch timed out."
      : "Worktree preparation did not complete.";
  if (record === undefined) throw new SessionWorktreeError(failure);
  const fields = record.split("\t");
  const [, encodedParent, commit, encodedDiagnostic] = fields;
  if (
    fields.length !== 4 ||
    encodedParent === undefined ||
    commit === undefined ||
    encodedDiagnostic === undefined
  ) {
    throw new SessionWorktreeError("The server returned malformed worktree preparation output.");
  }
  const parent = decodeHex(encodedParent);
  const diagnostic = decodeHex(encodedDiagnostic);
  const fetchError = diagnostic || (!completed || records.length !== 2 ? failure : undefined);
  if (!parent.startsWith("/") || !isCommit(commit)) {
    throw new SessionWorktreeError(
      fetchError ?? "The server returned no valid worktree destination or commit.",
    );
  }
  return { parent, commit, fetchError };
};

const createNativeWorktree = async (
  input: SessionWorktreeInput,
  project: ResolvedProject,
  parent: string,
  commit: string,
): Promise<LocationRef> => {
  try {
    const created = await input.api.worktree.create({
      projectID: project.id,
      strategy: "git",
      from: project.directory,
      directory: parent,
      branch: commit,
    });
    if (created.directory.trim() === "") {
      throw new SessionWorktreeError("The worktree was created without a directory.", {
        uncertain: true,
      });
    }
    return { directory: created.directory };
  } catch (cause) {
    if (cause instanceof SessionWorktreeError) throw cause;
    const message = isWorktreeError(cause)
      ? cause.data.message
      : cause instanceof Error
        ? cause.message
        : "The worktree could not be created.";
    throw new SessionWorktreeError(
      message + " A worktree may remain registered; inspect it before retrying.",
      { uncertain: true },
    );
  }
};

const resolveCreatedLocation = async (
  input: SessionWorktreeInput,
  retained: LocationRef,
): Promise<LocationRef> => {
  try {
    const final = await input.api.location.get({ location: requestLocation(retained) });
    if (final.directory.trim() === "") throw new Error("The server returned an empty location.");
    const finalLocation: LocationRef = { directory: final.directory };
    if (final.workspaceID !== undefined) finalLocation.workspaceID = final.workspaceID;
    return finalLocation;
  } catch {
    throw new SessionWorktreeError("The worktree location could not be resolved.", {
      location: retained,
    });
  }
};

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
    throw new SessionWorktreeError("The server returned malformed shell output.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};
const isCommit = (value: string): boolean => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);

const readOutput = async (
  api: SessionWorktreeClient["shell"],
  shellID: string,
  location: LocationRef,
  signal: AbortSignal,
): Promise<string> => {
  let cursor = 0;
  let output = "";
  for (let pageNumber = 0; pageNumber < MAX_OUTPUT_PAGES; pageNumber += 1) {
    const page = await api.output(
      { id: shellID, location: requestLocation(location), cursor, limit: OUTPUT_PAGE_SIZE },
      { signal },
    );
    if (page.data.truncated) throw new Error("The server truncated shell output.");
    output += page.data.output;
    if (page.data.cursor < cursor || page.data.cursor > page.data.size)
      throw new Error("The server returned an invalid shell output cursor.");
    if (page.data.cursor >= page.data.size) return output;
    if (page.data.cursor === cursor)
      throw new Error("The server returned shell output without progress.");
    cursor = page.data.cursor;
  }
  throw new Error("The server returned too many shell output pages.");
};

const runShell = async (
  input: SessionWorktreeInput,
  location: LocationRef,
  command: string,
): Promise<ShellRun> => {
  let shellID: string | undefined;
  let exit: ShellExitedEvent | undefined;
  let outputCollected = false;
  // Completion can arrive before shell.create returns the shell ID.
  const earlyExits = new Map<string, ShellExitedEvent>();
  const controller = new AbortController();
  const { signal } = controller;
  const timeoutID = setTimeout(
    () =>
      controller.abort(
        new SessionWorktreeError(
          "The server did not confirm shell completion before the request timed out.",
          { uncertain: true },
        ),
      ),
    COMPLETION_WAIT_MS,
  );
  let resolveExit!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  signal.addEventListener("abort", resolveExit, { once: true });
  const unsubscribe = input.onShellExited((event) => {
    if (shellID === event.data.id) {
      exit = event;
      resolveExit();
    } else if (shellID === undefined) {
      earlyExits.set(event.data.id, event);
    }
  });
  try {
    let created: Awaited<ReturnType<SessionWorktreeClient["shell"]["create"]>>;
    try {
      created = await input.api.shell.create(
        {
          location: requestLocation(location),
          command,
          cwd: location.directory,
          timeout: SHELL_TIMEOUT_MS,
        },
        { signal },
      );
    } catch (cause) {
      signal.throwIfAborted();
      const message =
        cause instanceof Error
          ? cause.message
          : "The server shell creation could not be confirmed.";
      throw new SessionWorktreeError(message, { uncertain: true });
    }
    shellID = created.data.id;
    exit = earlyExits.get(shellID);
    if (!exit) await completion;
    signal.throwIfAborted();
    if (!exit || exit.data.status === "running")
      throw new SessionWorktreeError("The server did not confirm shell completion.", {
        uncertain: true,
      });
    let output: string;
    try {
      output = await readOutput(input.api.shell, shellID, location, signal);
    } catch (cause) {
      signal.throwIfAborted();
      const message =
        cause instanceof Error ? cause.message : "The server shell output could not be collected.";
      throw new SessionWorktreeError(message, { uncertain: true });
    }
    outputCollected = true;
    return { event: exit, output, shell: created.data.shell };
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", resolveExit);
    try {
      if (shellID && outputCollected)
        await input.api.shell
          .remove({ id: shellID, location: requestLocation(location) }, { signal })
          .catch(() => undefined);
    } finally {
      clearTimeout(timeoutID);
    }
  }
};
