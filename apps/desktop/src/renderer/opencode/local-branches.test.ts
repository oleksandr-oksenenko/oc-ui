import type { OpenCodeClient, ShellCreateOutput } from "@opencode/client";
import { Fiber } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { deferred } from "../test/deferred.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { readLocalBranches } from "./local-branches.ts";

const fixture = () => {
  const location = { directory: "/server/project", workspaceID: "logical" };
  const result: ShellCreateOutput = {
    location: {
      ...location,
      project: { id: "project", directory: location.directory, canonical: location.directory },
    },
    data: {
      id: "shell",
      status: "exited",
      exit: 0,
      command: "git",
      cwd: location.directory,
      shell: "/bin/sh",
      file: "output",
      metadata: {},
      time: { started: 0 },
    },
  };
  const api = {
    config: {
      shells: vi
        .fn<OpenCodeClient["config"]["shells"]>()
        .mockResolvedValue([{ path: "/bin/sh", name: "sh", acceptable: true }]),
    },
    shell: {
      create: vi.fn<OpenCodeClient["shell"]["create"]>().mockResolvedValue(result),
      get: vi.fn<OpenCodeClient["shell"]["get"]>(),
      output: vi.fn<OpenCodeClient["shell"]["output"]>().mockResolvedValue({
        location: result.location,
        data: { output: "main\nfeature/topic\n", cursor: 0, size: 19, truncated: false },
      }),
      remove: vi.fn<OpenCodeClient["shell"]["remove"]>().mockResolvedValue(undefined),
    },
  };
  const effects = withTestWorkspace((owner) => owner);
  const read = readLocalBranches(effects, api, location);
  return { api, effects, location, result, read };
};

describe("local branch reads", () => {
  it("reads only local refs using the server location and removes its shell on success or failure", async () => {
    const fake = fixture();
    await expect(fake.effects.runPromise(fake.read)).resolves.toEqual(["main", "feature/topic"]);
    expect(fake.api.shell.create).toHaveBeenCalledWith(
      {
        location: { directory: fake.location.directory, workspace: "logical" },
        cwd: fake.location.directory,
        command: "git for-each-ref --format='%(refname:strip=2)' refs/heads",
        timeout: 10_000,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(fake.api.shell.remove).toHaveBeenCalledWith(
      { id: "shell", location: { directory: fake.location.directory, workspace: "logical" } },
      { signal: expect.any(AbortSignal) },
    );
    fake.api.shell.output.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(fake.effects.runPromise(fake.read)).rejects.toThrow("could not be read");
    expect(fake.api.shell.remove).toHaveBeenCalledTimes(2);
  });

  it("retains a cancelled shell acquisition until it settles and then removes the resource", async () => {
    const fake = fixture();
    const started = deferred();
    const pending = deferred<ShellCreateOutput>();
    fake.api.shell.create.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const fiber = fake.effects.runFork(fake.read);
    await started.promise;
    let finished = false;
    const interrupted = fake.effects.runPromise(Fiber.interrupt(fiber)).finally(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    pending.resolve(fake.result);
    await interrupted;
    expect(fake.api.shell.remove).toHaveBeenCalledTimes(1);
    expect(fake.api.shell.output).not.toHaveBeenCalled();
  });
  it("leaves a running shell and its server timeout intact on interruption", async () => {
    const fake = fixture();
    fake.result.data.status = "running";
    fake.api.shell.get.mockResolvedValue(fake.result);
    const fiber = fake.effects.runFork(fake.read);
    await vi.waitFor(() => expect(fake.api.shell.create).toHaveBeenCalled());
    await fake.effects.runPromise(Fiber.interrupt(fiber));
    expect(fake.api.shell.remove).not.toHaveBeenCalled();
  });
});
