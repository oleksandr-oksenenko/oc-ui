import type { OpenCodeClient } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { deferred } from "../test/deferred.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import {
  createSessionWorktree as createEffect,
  type SessionWorktreeInput,
} from "./create-session-worktree.ts";

const root = "/srv/project";
const destination = "/server-owned/worktrees/generated";
const fixture = (branch = "main", directory = root) => {
  let current = true;
  const resolved = {
    directory,
    project: { id: "project", directory, canonical: directory },
  };
  const api = {
    location: {
      get: vi
        .fn<OpenCodeClient["location"]["get"]>()
        .mockResolvedValueOnce(resolved)
        .mockResolvedValue({ ...resolved, directory: destination }),
    },
    vcs: {
      get: vi.fn<OpenCodeClient["vcs"]["get"]>().mockResolvedValue({
        location: resolved,
        data: { branch: { current: "feature", default: branch } },
      }),
    },
    worktree: {
      create: vi
        .fn<OpenCodeClient["worktree"]["create"]>()
        .mockResolvedValue({ directory: destination }),
      list: vi.fn<OpenCodeClient["worktree"]["list"]>(),
      remove: vi.fn<OpenCodeClient["worktree"]["remove"]>(),
      refresh: vi.fn<OpenCodeClient["worktree"]["refresh"]>(),
    },
  };
  const input: SessionWorktreeInput = {
    api,
    effects: withTestWorkspace((effects) => effects),
    isCurrent: () => current,
  };
  return {
    api,
    input,
    cancel: () => {
      current = false;
    },
    run: () => input.effects.runPromise(createEffect(input, { directory })),
  };
};

describe("createSessionWorktree", () => {
  it.each(["main", "master", "trunk", "release/stable"])(
    "uses OpenCode's local default %s and server-owned placement",
    async (branch) => {
      const fake = fixture(branch);
      await expect(fake.run()).resolves.toEqual({ location: { directory: destination } });
      expect(fake.api.vcs.get).toHaveBeenCalledWith(
        { location: { directory: root } },
        { signal: expect.any(AbortSignal) },
      );
      expect(fake.api.worktree.create).toHaveBeenCalledWith(
        {
          location: { directory: root },
          strategy: "git",
          from: root,
          branch: "refs/heads/" + branch,
        },
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it.each(["C:\\project", "\\\\server\\share\\project"])(
    "delegates server path handling for %s",
    async (directory) => {
      const fake = fixture("trunk", directory);
      await expect(fake.run()).resolves.toEqual({ location: { directory: destination } });
      expect(fake.api.worktree.create).toHaveBeenCalledWith(
        expect.objectContaining({ from: directory }),
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it("stops when the server has no default branch instead of using the current branch", async () => {
    const fake = fixture();
    fake.api.vcs.get.mockResolvedValueOnce({
      location: { directory: root, project: { id: "project", directory: root, canonical: root } },
      data: { branch: { current: "feature" } },
    });
    await expect(fake.run()).rejects.toThrow("could not identify a default branch");
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("reports discovery failure without attempting creation", async () => {
    const fake = fixture();
    fake.api.vcs.get.mockRejectedValueOnce(new Error("offline"));
    await expect(fake.run()).rejects.toThrow("default branch could not be resolved");
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("checks cancellation after discovery", async () => {
    const fake = fixture();
    fake.api.vcs.get.mockImplementationOnce(async () => {
      fake.cancel();
      return {
        location: { directory: root, project: { id: "project", directory: root, canonical: root } },
        data: { branch: { default: "main" } },
      };
    });
    await expect(fake.run()).rejects.toThrow("cancelled");
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("keeps an interrupted native request owned until it settles", async () => {
    const fake = fixture();
    const pending = deferred<Awaited<ReturnType<OpenCodeClient["worktree"]["create"]>>>();
    let signal: AbortSignal | undefined;
    fake.api.worktree.create.mockImplementationOnce((_input, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const outcome = fake.run().catch(() => undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    let closed = false;
    const closing = Effect.runPromise(Scope.close(fake.input.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).toBe(false);
    pending.resolve({ directory: destination });
    await closing;
    await outcome;
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("retains the created path if cancellation follows creation", async () => {
    const fake = fixture();
    fake.api.worktree.create.mockImplementationOnce(async () => {
      fake.cancel();
      return { directory: destination };
    });
    await expect(fake.run()).rejects.toMatchObject({ location: { directory: destination } });
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("preserves native creation errors without cleanup or retry", async () => {
    const fake = fixture();
    fake.api.worktree.create.mockRejectedValueOnce({
      name: "WorktreeError",
      data: { message: "missing local branch" },
    });
    await expect(fake.run()).rejects.toMatchObject({
      uncertain: true,
      message: expect.stringContaining("missing local branch"),
    });
    expect(fake.api.worktree.create).toHaveBeenCalledOnce();
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("retains the created path if final location resolution fails", async () => {
    const fake = fixture();
    fake.api.location.get
      .mockReset()
      .mockResolvedValueOnce({
        directory: root,
        project: { id: "project", directory: root, canonical: root },
      })
      .mockRejectedValueOnce(new Error("unavailable"));
    await expect(fake.run()).rejects.toMatchObject({ location: { directory: destination } });
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("stops before discovery when project resolution fails", async () => {
    const fake = fixture();
    fake.api.location.get.mockReset().mockRejectedValueOnce(new Error("unavailable"));
    await expect(fake.run()).rejects.toThrow("project location could not be resolved");
    expect(fake.api.vcs.get).not.toHaveBeenCalled();
    expect(fake.api.worktree.create).not.toHaveBeenCalled();
  });

  it("reports an empty creation path without retry or cleanup", async () => {
    const fake = fixture();
    fake.api.worktree.create.mockResolvedValueOnce({ directory: "" });
    await expect(fake.run()).rejects.toMatchObject({ uncertain: true });
    expect(fake.api.location.get).toHaveBeenCalledOnce();
    expect(fake.api.worktree.create).toHaveBeenCalledOnce();
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("retains the created path when final resolution returns an empty directory", async () => {
    const fake = fixture();
    fake.api.location.get.mockResolvedValue({
      directory: "",
      project: { id: "project", directory: root, canonical: root },
    });
    await expect(fake.run()).rejects.toMatchObject({ location: { directory: destination } });
    expect(fake.api.worktree.remove).not.toHaveBeenCalled();
  });

  it("rejects logical workspaces before server calls", async () => {
    const fake = fixture();
    await expect(
      fake.input.effects.runPromise(
        createEffect(fake.input, { directory: root, workspaceID: "logical" }),
      ),
    ).rejects.toThrow("logical workspaces");
    expect(fake.api.location.get).not.toHaveBeenCalled();
  });
});
