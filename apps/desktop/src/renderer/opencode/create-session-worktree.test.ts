/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client";
import { Effect, Exit, Schema, Scope } from "effect";
import { deferred } from "../test/deferred.ts";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../test/workspace.ts";
import { createOpenCodeEventSource } from "./event-source.ts";
import {
  createSessionWorktree as createSessionWorktreeEffect,
  SessionWorktreeError,
  type SessionWorktreeInput,
} from "./create-session-worktree.ts";

const createSessionWorktree = (...args: Parameters<typeof createSessionWorktreeEffect>) =>
  args[0].effects.runPromise(createSessionWorktreeEffect(...args));

const root = "/srv/project";
const parent = "/srv/data/opencode/worktree";
const cached = "1111111111111111111111111111111111111111";
const fetched = "2222222222222222222222222222222222222222";

const hex = (value: string): string =>
  [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const record = (directory: string, commit: string, diagnostic = ""): string =>
  "\nOCUI1\t" + hex(directory) + "\t" + commit + "\t" + hex(diagnostic) + "\n";

type FixtureOptions = {
  readonly fetchFails?: boolean;
  readonly preparationOutput?: string;
  readonly fetchTimeout?: boolean;
  readonly withoutCache?: boolean;
  readonly endAfterNativeCreate?: boolean;
  readonly nativeError?: string;
  readonly omitExitFor?: number;
  readonly responseTimeout?: boolean;
  readonly runningCompletion?: boolean;
  readonly shell?: string;
};
const fixture = (options: FixtureOptions = {}) => {
  const events = createOpenCodeEventSource();
  const output = new Map<string, string>();
  let shellNumber = 0;
  let current = true;
  const shellCreate = vi.fn<OpenCodeClient["shell"]["create"]>(async ({ command }) => {
    shellNumber += 1;
    const id = "shell-" + shellNumber;
    const isProbe = command.includes("OCUI-SHELL-PROBE");
    const commandOutput = isProbe
      ? "OCUI-SHELL-PROBE\n"
      : (options.preparationOutput ??
        record(parent, options.withoutCache ? "" : cached) +
          (options.fetchTimeout
            ? ""
            : record(
                parent,
                options.fetchFails ? (options.withoutCache ? "" : cached) : fetched,
                options.fetchFails ? "origin unavailable" : "",
              )));
    output.set(id, commandOutput);
    if (options.omitExitFor !== shellNumber) {
      events.emit({
        id: "event-" + id,
        created: shellNumber,
        type: "shell.exited",
        data: {
          id,
          status: options.runningCompletion
            ? "running"
            : !isProbe && options.fetchTimeout
              ? "timeout"
              : "exited",
          exit: isProbe && options.shell ? 1 : 0,
        },
      } satisfies OpenCodeEvent);
    }
    return {
      location: { directory: root, project: { id: "project", directory: root, canonical: root } },
      data: {
        id,
        status: options.responseTimeout ? "timeout" : "exited",
        command,
        cwd: root,
        shell: options.shell ?? "/bin/zsh",
        file: "/tmp/" + id,
        metadata: {},
        time: { started: shellNumber, completed: shellNumber },
      },
    } satisfies Awaited<ReturnType<OpenCodeClient["shell"]["create"]>>;
  });
  const shellOutput = vi.fn<OpenCodeClient["shell"]["output"]>(async ({ id }) => {
    const text = output.get(id) ?? "";
    const size = new TextEncoder().encode(text).byteLength;
    return {
      location: { directory: root, project: { id: "project", directory: root, canonical: root } },
      data: { output: text, cursor: size, size, truncated: false },
    } satisfies Awaited<ReturnType<OpenCodeClient["shell"]["output"]>>;
  });
  const shellRemove = vi.fn<OpenCodeClient["shell"]["remove"]>(async () => undefined);
  const worktreeCreate = vi.fn<OpenCodeClient["worktree"]["create"]>(async () => {
    if (options.nativeError)
      throw { name: "WorktreeError", data: { message: options.nativeError } };
    if (options.endAfterNativeCreate) current = false;
    return { directory: parent + "/generated" };
  });
  let locationCalls = 0;
  const api = {
    location: {
      get: vi.fn<OpenCodeClient["location"]["get"]>(async () => {
        locationCalls += 1;
        if (locationCalls === 1) {
          return {
            directory: root,
            project: { id: "project", directory: root, canonical: root },
          };
        }
        return {
          directory: parent + "/generated",
          project: { id: "project", directory: root, canonical: root },
        };
      }),
    },
    shell: {
      create: shellCreate,
      output: shellOutput,
      remove: shellRemove,
      list: vi.fn<OpenCodeClient["shell"]["list"]>(),
      get: vi.fn<OpenCodeClient["shell"]["get"]>(),
      timeout: vi.fn<OpenCodeClient["shell"]["timeout"]>(),
    },
    worktree: {
      create: worktreeCreate,
      list: vi.fn<OpenCodeClient["worktree"]["list"]>(),
      remove: vi.fn<OpenCodeClient["worktree"]["remove"]>(),
      refresh: vi.fn<OpenCodeClient["worktree"]["refresh"]>(),
    },
  };
  const input: SessionWorktreeInput = {
    effects: withTestWorkspace((effects) => effects),
    api,
    onShellExited: (handler) => events.on("shell.exited", handler),
    isCurrent: () => current,
  };
  return { api, input, events };
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

describe("createSessionWorktree", () => {
  it("keeps shell ownership until an aborted SDK request actually settles", async () => {
    const fake = fixture();
    const pendingShell = deferred<Awaited<ReturnType<OpenCodeClient["shell"]["create"]>>>();
    const unsubscribe = vi.fn<() => void>();
    let signal: AbortSignal | undefined;
    fake.api.shell.create.mockImplementationOnce((_input, options) => {
      signal = options?.signal;
      return pendingShell.promise;
    });
    const request = createSessionWorktree(
      { ...fake.input, onShellExited: () => unsubscribe },
      { directory: root },
    );
    const outcome = request.catch(() => undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    let closed = false;
    const closing = Effect.runPromise(Scope.close(fake.input.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
    pendingShell.reject(new Error("request settled"));
    await closing;
    await outcome;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("releases the completion subscription when its workspace closes", async () => {
    const fake = fixture({ omitExitFor: 1 });
    const unsubscribe = vi.fn<() => void>();
    const request = createSessionWorktree(
      { ...fake.input, onShellExited: () => unsubscribe },
      { directory: root },
    );
    const outcome = request.catch(() => undefined);
    await vi.waitFor(() => expect(fake.api.shell.create).toHaveBeenCalledOnce());
    await Effect.runPromise(Scope.close(fake.input.effects.scope, Exit.void));
    await outcome;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(fake.api.shell.output).not.toHaveBeenCalled();
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("buffers an early zsh completion and creates at the fetched immutable commit", async () => {
    const fake = fixture();
    const result = await createSessionWorktree(fake.input, { directory: root });

    expect(result).toEqual({ location: { directory: parent + "/generated" } });
    expect(fake.api.worktree.create).toHaveBeenCalledWith(
      {
        projectID: "project",
        strategy: "git",
        from: root,
        directory: parent,
        branch: fetched,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fake.api.shell.create).toHaveBeenCalledTimes(2);
    expect(fake.api.shell.remove).toHaveBeenCalledTimes(2);
  });

  it.skipIf(platform() === "win32")(
    "fetches a rewritten default branch without changing the source checkout",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "ocui-fetch-test-"));
      const source = join(directory, "source");
      const origin = join(directory, "origin.git");
      const checkout = join(directory, "checkout");
      try {
        git(directory, "init", "--initial-branch=trunk", source);
        git(source, "commit", "--allow-empty", "-m", "original");
        git(directory, "clone", "--bare", source, origin);
        git(directory, "clone", origin, checkout);
        const original = git(checkout, "rev-parse", "HEAD");
        git(source, "commit", "--amend", "--allow-empty", "-m", "rewritten");
        git(source, "push", "--force", origin, "HEAD:refs/heads/trunk");
        const rewritten = git(source, "rev-parse", "HEAD");

        const fake = fixture();
        await createSessionWorktree(fake.input, { directory: root });
        const command = fake.api.shell.create.mock.calls[1]?.[0].command;
        if (!command) throw new Error("The helper did not request a fetch");
        const dataHome = join(directory, 'data "quoted"\t\n雪');
        const output = execFileSync("/bin/sh", ["-c", command], {
          cwd: checkout,
          encoding: "utf8",
          env: { ...process.env, XDG_DATA_HOME: dataHome },
        });

        expect(output).toBe(
          record(dataHome + "/opencode/worktree", original) +
            record(dataHome + "/opencode/worktree", rewritten),
        );
        expect(git(checkout, "rev-parse", "refs/remotes/origin/HEAD")).toBe(rewritten);
        expect(git(checkout, "rev-parse", "HEAD")).toBe(original);

        // The combined script preserves the cached default after origin becomes unavailable.
        git(checkout, "remote", "set-url", "origin", join(directory, "missing-origin"));
        const offline = execFileSync("/bin/sh", ["-c", command], {
          cwd: checkout,
          encoding: "utf8",
          env: { ...process.env, XDG_DATA_HOME: dataHome },
        });
        const replay = fixture({ preparationOutput: offline });
        const fallback = await createSessionWorktree(replay.input, { directory: root });
        expect(fallback.fetchError).toContain("missing-origin");
        expect(replay.api.worktree.create).toHaveBeenCalledWith(
          expect.objectContaining({
            directory: dataHome + "/opencode/worktree",
            branch: rewritten,
          }),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("uses the cached commit after a confirmed fetch failure and reports the failure", async () => {
    const fake = fixture({ fetchFails: true });
    const result = await createSessionWorktree(fake.input, { directory: root });

    expect(result).toEqual({
      location: { directory: parent + "/generated" },
      fetchError: "origin unavailable",
    });
    expect(fake.api.worktree.create).toHaveBeenCalledWith(
      expect.objectContaining({ branch: cached }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.skipIf(platform() === "win32")(
    "reports a Git failure that produces no diagnostic",
    async () => {
      const fake = fixture();
      await createSessionWorktree(fake.input, { directory: root });
      const command = fake.api.shell.create.mock.calls[1]?.[0].command;
      if (!command) throw new Error("The helper did not request preparation");
      const gitStub = `git() {
      case "$1" in
        symbolic-ref) printf 'refs/remotes/origin/trunk\\n' ;;
        rev-parse) printf '${cached}\\n' ;;
        *) return 1 ;;
      esac
    }`;
      const output = execFileSync("/bin/sh", ["-c", gitStub + "\n" + command], {
        encoding: "utf8",
        env: { ...process.env, XDG_DATA_HOME: "/srv/data" },
      });
      const replay = fixture({ preparationOutput: output });
      const result = await createSessionWorktree(replay.input, { directory: root });
      expect(result.fetchError).toBe("Origin discovery or fetch failed.");
      expect(replay.api.worktree.create).toHaveBeenCalledWith(
        expect.objectContaining({ branch: cached }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );

  it("uses the published cache after a confirmed preparation timeout", async () => {
    const fake = fixture({ fetchTimeout: true });
    const result = await createSessionWorktree(fake.input, { directory: root });
    expect(result.fetchError).toContain("timed out");
    expect(fake.api.worktree.create).toHaveBeenCalledWith(
      expect.objectContaining({ branch: cached }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not use a final result from a command that timed out", async () => {
    const fake = fixture({
      fetchTimeout: true,
      preparationOutput: record(parent, cached) + record(parent, fetched),
    });
    await createSessionWorktree(fake.input, { directory: root });
    expect(fake.api.worktree.create).toHaveBeenCalledWith(
      expect.objectContaining({ branch: cached }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not create after a preparation timeout without a cached commit", async () => {
    const fake = fixture({ fetchTimeout: true, withoutCache: true });
    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toThrow(
      "timed out",
    );
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("preserves encoded diagnostics while ignoring unrelated shell output", async () => {
    const diagnostic = 'origin "unavailable"\t\n雪';
    const fake = fixture({
      preparationOutput:
        "shell startup message\n" + record(parent, cached) + record(parent, cached, diagnostic),
    });
    const result = await createSessionWorktree(fake.input, { directory: root });
    expect(result.fetchError).toBe(diagnostic);
  });

  it.each(["OCUI1\t00\n", "OCUI1\tzz\t" + fetched + "\t\n", record(parent, "not-a-commit")])(
    "rejects malformed final preparation output: %s",
    async (final) => {
      const fake = fixture({ preparationOutput: record(parent, cached) + final });
      await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toBeInstanceOf(
        SessionWorktreeError,
      );
      expect(fake.api.worktree.create).not.toHaveBeenCalled();
    },
  );

  it("retains the created path when ownership ends after native creation", async () => {
    const fake = fixture({ endAfterNativeCreate: true });

    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toMatchObject({
      name: "SessionWorktreeError",
      location: { directory: parent + "/generated" },
    });
    expect(fake.api.worktree.create).toHaveBeenCalledOnce();
  });

  it("does not create a worktree when fetch fails without a cached commit", async () => {
    const fake = fixture({ fetchFails: true, withoutCache: true });

    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toMatchObject({
      name: "SessionWorktreeError",
    });
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("does not trust timeout status without a shell.exited completion", async () => {
    vi.useFakeTimers();
    try {
      const fake = fixture({ omitExitFor: 1, responseTimeout: true });
      const pending = createSessionWorktree(fake.input, { directory: root });
      const rejection = pending.then(
        () => undefined,
        (error: Error) =>
          Schema.is(SessionWorktreeError)(error) ? error : new Error("Unexpected rejection"),
      );
      await vi.runAllTimersAsync();
      await expect(rejection).resolves.toMatchObject({ uncertain: true });
      expect(fake.api.worktree.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["create", "output", "remove"] as const)(
    "aborts a stalled shell %s request at the deadline",
    async (method) => {
      vi.useFakeTimers();
      try {
        const fake = fixture();
        let requestSignal: AbortSignal | undefined;
        fake.api.shell[method].mockImplementationOnce(
          (_input, options) =>
            new Promise<never>((_resolve, reject) => {
              requestSignal = options?.signal;
              requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
                once: true,
              });
            }),
        );
        const pending = createSessionWorktree(fake.input, { directory: root });
        const result = pending.catch((error: Error) => error);
        await vi.runAllTimersAsync();

        expect(requestSignal?.aborted).toBe(true);
        const timeoutError = { uncertain: true, message: expect.stringContaining("timed out") };
        // Cleanup failure can proceed because the completed shell output was collected.
        await expect(result).resolves.toMatchObject(
          method === "remove" ? { location: { directory: parent + "/generated" } } : timeoutError,
        );
        expect(fake.api.worktree.create).toHaveBeenCalledTimes(method === "remove" ? 1 : 0);
        expect(fake.api.shell.remove).toHaveBeenCalledTimes(method === "remove" ? 2 : 0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("preserves the native error and warns that a worktree may remain", async () => {
    const fake = fixture({ nativeError: "startup failed" });

    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toMatchObject({
      uncertain: true,
      message: expect.stringContaining("startup failed"),
    });
  });

  it("rejects a nonterminal completion without collecting or removing the shell", async () => {
    const fake = fixture({ runningCompletion: true });
    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toMatchObject({
      uncertain: true,
    });
    expect(fake.api.shell.output).not.toHaveBeenCalled();
    expect(fake.api.shell.remove).not.toHaveBeenCalled();
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("reports an unsupported shell even when the probe command fails", async () => {
    const fake = fixture({ shell: "/usr/bin/fish" });
    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toThrow(
      "The connected server shell (fish) is unsupported.",
    );
    expect(fake.api.shell.create).toHaveBeenCalledOnce();
  });

  it("retains the created path when final location resolution returns an empty directory", async () => {
    const fake = fixture();
    fake.api.location.get
      .mockResolvedValueOnce({
        directory: root,
        project: { id: "project", directory: root, canonical: root },
      })
      .mockResolvedValueOnce({
        directory: "",
        project: { id: "project", directory: root, canonical: root },
      });
    await expect(createSessionWorktree(fake.input, { directory: root })).rejects.toMatchObject({
      location: { directory: parent + "/generated" },
    });
  });

  it("rejects logical workspaces before any server call", async () => {
    const fake = fixture();

    await expect(
      createSessionWorktree(fake.input, { directory: root, workspaceID: "logical" }),
    ).rejects.toBeInstanceOf(SessionWorktreeError);
    expect(fake.api.location.get).not.toHaveBeenCalled();
    expect(fake.api.shell.create).not.toHaveBeenCalled();
  });
});
