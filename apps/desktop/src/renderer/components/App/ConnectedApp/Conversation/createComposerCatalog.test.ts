import type { CommandInfo, LocationRef, SkillInfo } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createComposerCatalog } from "./createComposerCatalog.ts";

type Sources = Parameters<typeof createComposerCatalog>[0]["sources"];
type CommandSource = Sources["commands"];
type SkillSource = Sources["skills"];

const location: LocationRef = { directory: "/project", workspaceID: "workspace" };
const command = (name: string): CommandInfo => ({ name });
const skill = (name: string, slash = true): SkillInfo => ({
  id: name,
  name,
  slash,
  location: "/skills/" + name,
  content: "Instructions",
});

function source<T>(sync: () => Promise<void>, items: () => T[]) {
  return {
    sync: vi.fn<() => Promise<void>>(sync),
    list: vi.fn<() => T[]>(items),
    invalidate: vi.fn<() => void>(),
  };
}

function setup(
  input: {
    commandSync?: CommandSource["sync"];
    skillSync?: SkillSource["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selected, setSelected] = createSignal<LocationRef | undefined>(location);
    const [connected, setConnected] = createSignal(true);
    const [commands, setCommands] = createSignal<CommandInfo[]>([
      command("init"),
      command("review"),
    ]);
    const [skills, setSkills] = createSignal<SkillInfo[]>([
      skill("review"),
      skill("hidden", false),
    ]);
    const sources = {
      commands: source<CommandInfo>(input.commandSync ?? (async () => undefined), () => commands()),
      skills: source<SkillInfo>(input.skillSync ?? (async () => undefined), () => skills()),
    };
    const catalog = createComposerCatalog({ effects, sources, location: selected, connected });
    return { catalog, sources, setSelected, setConnected, setCommands, setSkills, dispose };
  });
}

describe("composer catalog", () => {
  it("reads both inventories for the session location without copying them", async () => {
    const state = setup();
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("ready"));
    await vi.waitFor(() => expect(state.catalog.skills.state).toBe("ready"));
    expect(state.sources.commands.sync).toHaveBeenCalledWith(location);
    expect(state.sources.skills.sync).toHaveBeenCalledWith(location);
    expect(state.catalog.commands.items.map((item) => item.name)).toEqual(["init", "review"]);
    expect(state.catalog.skills.items.map((item) => item.name)).toEqual(["review"]);

    state.setCommands([command("updated")]);
    state.setSkills([skill("testing")]);
    expect(state.catalog.commands.items.map((item) => item.name)).toEqual(["updated"]);
    expect(state.catalog.skills.items.map((item) => item.name)).toEqual(["testing"]);
  });

  it("settles sections independently and retries only the failed section", async () => {
    const state = setup({
      commandSync: vi
        .fn<CommandSource["sync"]>()
        .mockRejectedValueOnce(new Error("Offline"))
        .mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("failed"));
    await vi.waitFor(() => expect(state.catalog.skills.state).toBe("ready"));
    expect(state.catalog.commands.items).toEqual([]);
    expect(state.catalog.skills.items.map((item) => item.name)).toEqual(["review"]);

    state.catalog.onRetry();
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("ready"));
    expect(state.sources.commands.sync).toHaveBeenCalledTimes(2);
    expect(state.sources.skills.sync).toHaveBeenCalledTimes(1);
  });

  it("keeps an obsolete failure from replacing the new location's ready state", async () => {
    const first = deferred();
    const state = setup({
      commandSync: vi
        .fn<CommandSource["sync"]>()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue(undefined),
    });
    state.setSelected({ directory: "/other", workspaceID: "other" });
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("ready"));
    first.reject(new Error("Obsolete location"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    expect(state.catalog.commands.state).toBe("ready");
  });

  it("marks both sections failed while disconnected and refreshes after reconnect", async () => {
    const state = setup();
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("ready"));
    expect(state.sources.commands.sync).toHaveBeenCalledTimes(1);

    state.setConnected(false);
    expect(state.catalog.commands.state).toBe("failed");
    expect(state.catalog.skills.state).toBe("failed");
    expect(state.catalog.commands.items).toEqual([]);
    expect(state.sources.commands.sync).toHaveBeenCalledTimes(1);

    state.setConnected(true);
    await vi.waitFor(() => expect(state.catalog.commands.state).toBe("ready"));
    await vi.waitFor(() => expect(state.catalog.skills.state).toBe("ready"));
    expect(state.sources.commands.sync).toHaveBeenCalledTimes(2);
  });

  it("retains settlement of a disposed read without publishing its result", async () => {
    const pending = deferred();
    const state = setup({ commandSync: () => pending.promise, skillSync: () => pending.promise });
    state.dispose();
    pending.resolve();
    await pending.promise;
    expect(state.catalog.commands.state).toBe("loading");
    expect(state.catalog.skills.state).toBe("loading");
  });
});
