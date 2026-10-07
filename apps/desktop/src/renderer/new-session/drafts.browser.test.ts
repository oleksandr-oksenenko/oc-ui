import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { RegistryContext } from "@effect/atom-solid";
import { createComponent, createRoot, createSignal, untrack } from "solid-js";
import { createNewSessionDrafts } from "../components/App/ConnectedApp/Conversation/createNewSessionDrafts.ts";
import { makeWorkspaceOwner } from "../workspace-owner.ts";
import { deferred } from "../test/deferred.ts";
import { draftLockName, withBrowserLock } from "./locks.ts";
import { sessionFixture } from "../test/session-fixture.ts";
import { createOpenCodeEventSource } from "../opencode/event-source.ts";
import { Storage, StorageError, makeStorage } from "../storage.ts";
import {
  draftDatabase,
  makeNewSessionDrafts,
  NewSessionDrafts,
  meaningfulDraft,
} from "./drafts.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
function fixture(
  // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- Native browser fixture IDs; the pinned Effect RC has no UUID API.
  name = crypto.randomUUID(),
  transform?: (storage: Storage["Service"]) => Storage["Service"],
) {
  const registry = AtomRegistry.make();
  const storage = Layer.effect(
    Storage,
    makeStorage({ ...draftDatabase, name }).pipe(
      Effect.map((service) => transform?.(service) ?? service),
    ),
  );
  const runtime = ManagedRuntime.make(
    Layer.effect(NewSessionDrafts, makeNewSessionDrafts(registry)).pipe(
      Layer.provideMerge(storage),
    ),
  );
  const service = runtime.runSync(NewSessionDrafts);
  cleanup.push(async () => {
    await runtime.dispose();
    registry.dispose();
  });
  return {
    runtime,
    service,
    registry,
    name,
    run: runtime.runPromise.bind(runtime),
    sync: runtime.runSync.bind(runtime),
  };
}
const choices = {
  mode: "local" as const,
  project: { id: "project", location: { directory: "/srv/project", workspaceID: "logical" } },
};

const sync = async () => undefined;
function controller(
  one: ReturnType<typeof fixture>,
  options: { currentBranch?: string; previous?: ReturnType<typeof sessionFixture> } = {
    currentBranch: "feature",
  },
) {
  const scope = Scope.makeUnsafe();
  const effects = Effect.runSync(
    makeWorkspaceOwner(one.registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const pending = deferred();
  const events = createOpenCodeEventSource();
  const projects = ["other", "project"].map((id) => ({
    id,
    canonical: `/srv/${id}`,
    vcs: "git" as const,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  }));
  const location = {
    ...choices.project.location,
    project: { id: "project", directory: "/srv/project", canonical: "/srv/project" },
  };
  const shell = {
    id: "shell",
    status: "exited" as const,
    exit: 0,
    command: "git",
    cwd: location.directory,
    shell: "/bin/sh",
    file: "output",
    metadata: {},
    time: { started: 0 },
  };
  const source = { sync, list: () => [], invalidate: () => undefined };
  const [connection, setConnection] =
    createSignal<ReturnType<Parameters<typeof createNewSessionDrafts>[0]["stream"]["status"]>>(
      "connected",
    );
  const runtime: Parameters<typeof createNewSessionDrafts>[0] = {
    effects,
    defaultLocation: choices.project.location,
    stream: { status: connection },
    data: {
      on: events.on,
      session: {
        create: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["data"]["session"]["create"]>(),
        prompt: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["data"]["session"]["prompt"]>(),
        remember:
          vi.fn<Parameters<typeof createNewSessionDrafts>[0]["data"]["session"]["remember"]>(),
      },
      project: { ...source, list: () => projects },
      location: {
        vcs: { ...source, info: () => undefined },
        command: { ...source },
        skill: { ...source },
        model: { ...source },
        agent: {
          ...source,
          list: () => [
            {
              id: "build",
              name: "Build",
              mode: "primary",
              hidden: false,
              request: { settings: {}, headers: {}, body: {} },
              permissions: [],
            },
          ],
        },
      },
    },
    api: {
      file: {
        list: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["file"]["list"]>(
          async () => ({ location, data: [] }),
        ),
      },
      plugin: { awaitActivation: sync },
      session: {
        get: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["session"]["get"]>(),
        message: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["session"]["message"]>(),
        command: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["session"]["command"]>(),
      },
      location: {
        get: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["location"]["get"]>(),
      },
      worktree: {
        list: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["worktree"]["list"]>(),
        create: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["worktree"]["create"]>(),
        remove: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["worktree"]["remove"]>(),
        refresh:
          vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["worktree"]["refresh"]>(),
      },
      vcs: {
        get: async () => {
          await pending.promise;
          return {
            location,
            data: { branch: { current: options.currentBranch, default: "main" } },
          };
        },
      },
      model: {
        default: async () => ({
          location,
          data: {
            id: "default-model",
            modelID: "default-model",
            name: "Default model",
            providerID: "provider",
            enabled: true,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [],
            time: { released: 0 },
            cost: [],
            status: "active",
            limit: { context: 1000, output: 100 },
          },
        }),
      },
      project: {
        current: vi.fn<Parameters<typeof createNewSessionDrafts>[0]["api"]["project"]["current"]>(),
      },
      config: {
        shells: async () => [{ path: "/bin/sh", name: "sh", acceptable: true }],
      },
      shell: {
        create: async () => ({ location, data: shell }),
        get: async () => ({ location, data: shell }),
        output: async () => ({
          location,
          data: { output: "main\nfeature\nchosen", cursor: 0, size: 19, truncated: false },
        }),
        remove: sync,
      },
    },
  };
  const selectSession = vi.fn<(id: string) => void>();
  let adapter!: ReturnType<typeof createNewSessionDrafts>;
  let select!: (id: string | undefined) => void;
  createRoot((dispose) => {
    cleanup.push(async () => {
      pending.resolve();
      dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      events.close();
    });
    createComponent(RegistryContext.Provider, {
      value: one.registry,
      get children() {
        untrack(() => {
          const [selectedDraftID, selectDraft] = createSignal<string>();
          select = selectDraft;
          adapter = createNewSessionDrafts(
            runtime,
            {
              selectedDraftID,
              selectDraft,
              selectedSession: () => options.previous,
              sessions: () => [],
              select: selectSession,
            },
            one.service,
            "server",
          );
        });
        return undefined;
      },
    });
  });
  return { adapter, select, pending, runtime, selectSession, setConnection, projects, events };
}

describe("native draft persistence", () => {
  it.each(["model", "agent"] as const)(
    "retries failed %s choices through the existing catalog owner without replacing draft content",
    async (catalog) => {
      const one = fixture();
      const { adapter, runtime, pending } = controller(one);
      const model = (await runtime.api.model.default({ location: choices.project.location })).data!;
      runtime.data.location.model.list = () => [model];
      runtime.data.location.model.invalidate =
        vi.fn<typeof runtime.data.location.model.invalidate>();
      runtime.data.location.agent.invalidate =
        vi.fn<typeof runtime.data.location.agent.invalidate>();
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      adapter.create();
      pending.resolve();
      await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
      const id = adapter.selectedID()!;
      adapter.composer(id).onInput("Keep this draft through catalog recovery");
      const before = one.service.get(id)!.value.choices;
      const syncCatalog = vi
        .fn<typeof runtime.data.location.model.sync>()
        .mockRejectedValueOnce(new Error("Catalog unavailable"))
        .mockResolvedValue(undefined);
      runtime.data.location[catalog].sync = syncCatalog;
      const selection = catalog === "model" ? "modelSelection" : "agentSelection";
      adapter.composer(id)[selection].onRetry!();
      await vi.waitFor(() => expect(adapter.current().catalogs).toBe("failed"));
      expect(adapter.composer(id).value).toBe("Keep this draft through catalog recovery");
      adapter.composer(id)[selection].onRetry!();
      await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
      expect(adapter.selectedID()).toBe(id);
      expect(one.service.get(id)!.value.choices).toEqual(before);
      expect(adapter.composer(id).value).toBe("Keep this draft through catalog recovery");
      expect(syncCatalog).toHaveBeenCalledTimes(2);
      expect(runtime.data.location.model.invalidate).toHaveBeenCalledWith(choices.project.location);
      expect(runtime.data.location.agent.invalidate).toHaveBeenCalledWith(choices.project.location);
      expect(runtime.data.session.create).not.toHaveBeenCalled();
      expect(runtime.data.session.prompt).not.toHaveBeenCalled();
    },
  );

  it.each(["ready", "pending"])(
    "cancels %s project reads on disconnect without a directory error and reloads on reconnect",
    async (phase) => {
      const one = fixture();
      const { adapter, runtime, pending, setConnection } = controller(one);
      const model = (await runtime.api.model.default({ location: { directory: "/srv/project" } }))
        .data!;
      runtime.data.location.model.list = () => [model];
      const directory = deferred<Awaited<ReturnType<typeof runtime.api.file.list>>>();
      let signal: AbortSignal | undefined;
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      vi.mocked(runtime.api.file.list).mockClear();
      if (phase === "pending") {
        cleanup.push(async () => directory.reject(new Error("Test cleanup")));
        vi.mocked(runtime.api.file.list).mockImplementationOnce((_input, options) => {
          signal = options?.signal;
          return directory.promise;
        });
      }
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      adapter.create();
      const id = adapter.selectedID()!;
      adapter.composer(id).onInput("Saved while quitting");
      await one.run(one.service.flush(id));
      await vi.waitFor(() => expect(runtime.api.file.list).toHaveBeenCalledOnce());
      pending.resolve();
      if (phase === "ready") await vi.waitUntil(() => adapter.current().catalogs === "ready");
      const before = adapter.current();

      setConnection("connecting");
      if (phase === "pending") {
        await vi.waitUntil(() => signal?.aborted === true);
        directory.reject(new Error("Server stopped"));
      }
      const restored = fixture(one.name);
      await restored.run(restored.service.hydrate("server"));
      expect(restored.service.get(id)?.value.text).toBe("Saved while quitting");
      expect(adapter.current()).toEqual(before);
      expect(adapter.composer(id).error).toBeUndefined();
      expect(adapter.composer(id).disabled).toBe(true);
      expect(runtime.api.file.list).toHaveBeenCalledOnce();

      setConnection("connected");
      await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
      expect(runtime.api.file.list).toHaveBeenCalledTimes(4);
      expect(adapter.composer(id).value).toBe("Saved while quitting");
    },
  );

  it.each([undefined, "other"])(
    "uses the current session project %s or server default instead of the first catalog entry",
    async (projectID) => {
      const one = fixture();
      const { adapter } = controller(one, {
        previous: projectID
          ? sessionFixture({ id: "previous", projectID, location: { directory: "/srv/other" } })
          : undefined,
      });
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      adapter.create();
      expect(adapter.selected()?.value.choices.project?.id).toBe(projectID ?? "project");
    },
  );

  it("keeps content when a saved project directory is unavailable and loads another project", async () => {
    const one = fixture();
    const { adapter, runtime, pending } = controller(one);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    vi.mocked(runtime.api.file.list).mockClear();
    vi.mocked(runtime.api.file.list).mockRejectedValueOnce(new Error("UnexpectedStatus"));
    const modelSync = vi.spyOn(runtime.data.location.model, "sync");
    const agentSync = vi.spyOn(runtime.data.location.agent, "sync");
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    adapter.create();
    const id = adapter.selectedID()!;
    adapter.composer(id).onInput("Keep my prompt");
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("failed"));
    expect(adapter.composer(id).error).toContain(
      "The project directory could not be opened: /srv/project",
    );
    expect(adapter.composer(id).disabled).toBe(true);
    expect(modelSync).not.toHaveBeenCalled();
    expect(agentSync).not.toHaveBeenCalled();
    expect(runtime.api.file.list).toHaveBeenCalledWith(
      { location: { directory: "/srv/project", workspace: "logical" }, path: "/srv/project" },
      { signal: expect.any(AbortSignal) },
    );
    adapter.setup().onProjectChange("other");
    pending.resolve();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.composer(id).value).toBe("Keep my prompt");
    expect(adapter.current().error).toBeUndefined();
  });

  it("disables unavailable directories without registering them and restores them on retry", async () => {
    const one = fixture();
    const { adapter, runtime, pending } = controller(one);
    const model = (await runtime.api.model.default({ location: { directory: "/srv/project" } }))
      .data!;
    runtime.data.location.model.list = () => [model];
    vi.mocked(runtime.api.file.list).mockImplementation(async (input) => {
      if (input?.path === "/srv/other") throw new Error("Missing directory");
      return {
        location: {
          ...choices.project.location,
          project: { id: "project", directory: "/srv/project", canonical: "/srv/project" },
        },
        data: [],
      };
    });
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    expect(adapter.setup().projects.map((item) => [item.id, item.disabled])).toEqual([
      ["other", true],
      ["project", false],
    ]);
    expect(runtime.api.project.current).not.toHaveBeenCalled();
    expect(runtime.api.file.list).toHaveBeenCalledWith(
      { location: { directory: "/srv/project", workspace: "logical" }, path: "/srv/other" },
      { signal: expect.any(AbortSignal) },
    );
    adapter.create();
    pending.resolve();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.composer(adapter.selectedID()!).error).toBeUndefined();
    adapter.setup().onProjectChange("other");
    expect(adapter.selected()?.value.choices.project?.id).toBe("project");
    vi.mocked(runtime.api.file.list).mockResolvedValue({
      location: {
        ...choices.project.location,
        project: { id: "project", directory: "/srv/project", canonical: "/srv/project" },
      },
      data: [],
    });
    adapter.setup().onRetryProjects!();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.setup().projects.map((item) => [item.id, item.disabled])).toEqual([
      ["other", false],
      ["project", false],
    ]);
    expect(adapter.current().projectsError).toBeUndefined();
    expect(adapter.composer(adapter.selectedID()!).error).toBeUndefined();
  });

  it("does not approve a project path changed during a pending directory check", async () => {
    const one = fixture();
    const { adapter, runtime, projects } = controller(one);
    const directory = deferred<Awaited<ReturnType<typeof runtime.api.file.list>>>();
    cleanup.push(async () => directory.reject(new Error("Test cleanup")));
    const response = {
      location: {
        ...choices.project.location,
        project: { id: "project", directory: "/srv/project", canonical: "/srv/project" },
      },
      data: [],
    };
    vi.mocked(runtime.api.file.list).mockImplementation(async (input) =>
      input?.path === "/srv/project" ? directory.promise : response,
    );
    await vi.waitFor(() => expect(runtime.api.file.list).toHaveBeenCalledTimes(2));
    projects.find((item) => item.id === "project")!.canonical = "/srv/moved";
    directory.resolve(response);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    expect(adapter.setup().projects.map((item) => [item.id, item.disabled])).toEqual([
      ["other", false],
      ["project", true],
    ]);
    adapter.create();
    expect(adapter.selected()?.value.choices.project).toBeUndefined();
    expect(adapter.composer(adapter.selectedID()!).error).toBeUndefined();
    expect(runtime.api.project.current).not.toHaveBeenCalled();
    adapter.retry();
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    expect(adapter.setup().projects.find((item) => item.id === "project")?.detail).toBe(
      "/srv/moved",
    );
  });

  it.each(["text", "file"])(
    "resolves defaults after %s autosaves ahead of server catalogs",
    async (content) => {
      const one = fixture();
      const { adapter, pending } = controller(one);
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      adapter.create();
      const id = adapter.selectedID()!;
      if (content === "text") adapter.composer(id).onInput("Typed while loading");
      else adapter.composer(id).onAttachFiles!([new File(["bytes"], "early.txt")]);
      await one.run(one.service.flush(id));
      expect(one.service.get(id)?.saved).toBeDefined();
      expect(one.service.get(id)?.value.choices.branch).toBeUndefined();
      pending.resolve();
      await vi.waitFor(() =>
        expect(one.service.get(id)?.value.choices).toMatchObject({
          branch: { kind: "existing", name: "feature" },
          branchSource: "default",
          agent: "build",
          model: { id: "default-model", providerID: "provider" },
        }),
      );
      await one.run(one.service.flush(id));
      const reloaded = fixture(one.name);
      await reloaded.run(reloaded.service.hydrate("server"));
      expect(reloaded.service.get(id)?.value.choices).toEqual(one.service.get(id)?.value.choices);
    },
  );

  it("resolves a saved draft's missing choices on reopen and after changing project", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Saved before catalogs" }));
    await one.run(one.service.flush(id));
    one.service.release(id);
    const { adapter, select, pending } = controller(one);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    select(id);
    pending.resolve();
    await vi.waitFor(() => expect(one.service.get(id)?.value.choices.agent).toBe("build"));
    adapter.setup().onProjectChange("other");
    await vi.waitFor(() =>
      expect(one.service.get(id)?.value.choices).toMatchObject({
        project: { id: "other" },
        branch: { name: "feature" },
        agent: "build",
        model: { id: "default-model" },
      }),
    );
  });

  it("discovers draft defaults and variants at the selected project location", async () => {
    const one = fixture();
    const { adapter, runtime, pending } = controller(one);
    const original = await runtime.api.model.default();
    const first = { ...original.data!, variants: [{ id: "project-depth" }] };
    const second = {
      ...first,
      id: "other-model",
      name: "Other model",
      variants: [{ id: "other-depth" }],
    };
    runtime.data.location.model.list = (target) => [
      target?.directory === "/srv/other" ? second : first,
    ];
    runtime.api.model.default = vi.fn<typeof runtime.api.model.default>(async (input) => ({
      ...original,
      data: input?.location?.directory === "/srv/other" ? second : first,
    }));
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    adapter.create();
    pending.resolve();
    const id = adapter.selectedID()!;
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.composer(id).modelSelection?.variants).toEqual([
      { id: "project-depth", label: "project-depth" },
    ]);
    adapter.setup().onProjectChange("other");
    await vi.waitFor(() =>
      expect(one.service.get(id)?.value.choices.model?.id).toBe("other-model"),
    );
    expect(adapter.composer(id).modelSelection?.models.map((item) => item.label)).toEqual([
      "Other model",
    ]);
    expect(adapter.composer(id).modelSelection?.variants).toEqual([
      { id: "other-depth", label: "other-depth" },
    ]);
    expect(runtime.api.model.default).toHaveBeenLastCalledWith(
      { location: { directory: "/srv/other", workspace: "logical" } },
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each(["feature", undefined])(
    "uses the default branch for first Worktree selection from %s",
    async (currentBranch) => {
      const one = fixture();
      const { adapter, pending } = controller(one, { currentBranch });
      await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
      adapter.create();
      pending.resolve();
      await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
      expect(adapter.setup().branch?.name).toBe(currentBranch);
      adapter.setup().onModeChange("worktree");
      expect(adapter.setup().branch).toEqual({ kind: "existing", name: "main" });
      adapter.setup().onModeChange("local");
      expect(adapter.setup().branch?.name).toBe(currentBranch);
      adapter.setup().onBranchChange({ kind: "existing", name: "chosen" });
      adapter.setup().onModeChange("worktree");
      expect(adapter.setup().branch).toEqual({ kind: "existing", name: "chosen" });
    },
  );

  it("preserves explicit and remembered choices when catalogs arrive", async () => {
    const one = fixture();
    const { adapter, pending } = controller(one);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    adapter.create();
    const id = adapter.selectedID()!;
    adapter.setup().onBranchChange({ kind: "existing", name: "chosen" });
    one.sync(
      one.service.edit(id, {
        choices: {
          ...one.service.get(id)!.value.choices,
          agent: "custom",
          model: { id: "custom", providerID: "custom" },
        },
      }),
    );
    adapter.composer(id).onInput("Explicit choices");
    await one.run(one.service.flush(id));
    pending.resolve();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(one.service.get(id)?.value.choices).toMatchObject({
      branch: { name: "chosen" },
      agent: "custom",
      model: { id: "custom" },
    });
    adapter.create();
    expect(adapter.selectedID()).not.toBe(id);
    adapter.setup().onModeChange("worktree");
    expect(adapter.setup().branch).toEqual({ kind: "existing", name: "chosen" });
  });

  it("fills an older draft's defaults without replacing a newer remembered branch", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Saved before defaults" }));
    await one.run(one.service.flush(id));
    const another = fixture(one.name);
    await another.run(another.service.hydrate("server"));
    const otherID = another.sync(another.service.create("server", choices));
    another.sync(
      another.service.edit(otherID, {
        choices: { ...choices, branch: { kind: "existing", name: "chosen" } },
      }),
    );
    await another.run(another.service.flush(otherID));
    const reopened = fixture(one.name);
    const { adapter, select, pending } = controller(reopened);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    expect(reopened.service.choices("server").branch).toEqual({ kind: "existing", name: "chosen" });
    select(id);
    pending.resolve();
    await vi.waitFor(() =>
      expect(reopened.service.get(id)?.value.choices.branch).toEqual({
        kind: "existing",
        name: "feature",
      }),
    );
    await reopened.run(reopened.service.flush(id));
    const reloaded = fixture(one.name);
    await reloaded.run(reloaded.service.hydrate("server"));
    expect(reloaded.service.get(id)?.value.choices.branch).toEqual({
      kind: "existing",
      name: "feature",
    });
    expect(reloaded.service.choices("server").branch).toEqual({ kind: "existing", name: "chosen" });
  });

  it("remembers an explicit selection of the already displayed automatic branch", async () => {
    const one = fixture();
    const options = { currentBranch: "feature" };
    const { adapter, pending } = controller(one, options);
    await vi.waitFor(() => expect(adapter.canCreate()).toBe(true));
    adapter.create();
    pending.resolve();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.setup().branch).toEqual({ kind: "existing", name: "feature" });
    expect(one.service.choices("server").branch).toBeUndefined();
    adapter.setup().onBranchChange({ kind: "existing", name: "feature" });
    const id = adapter.selectedID()!;
    adapter.composer(id).onInput("Explicitly selected feature");
    await one.run(one.service.flush(id));
    const reloaded = fixture(one.name);
    await reloaded.run(reloaded.service.hydrate("server"));
    expect(reloaded.service.choices("server").branch).toEqual({
      kind: "existing",
      name: "feature",
    });
    options.currentBranch = "main";
    adapter.create();
    await vi.waitFor(() => expect(adapter.current().catalogs).toBe("ready"));
    expect(adapter.setup().branch).toEqual({ kind: "existing", name: "feature" });
  });

  it("does not overwrite another window's project when editing branch, model or agent", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Project A" }));
    await one.run(one.service.flush(id));
    const two = fixture(one.name);
    await two.run(two.service.hydrate("server"));
    const projectB = { id: "other", location: { directory: "/srv/other" } };
    const otherID = two.sync(two.service.create("server", { mode: "local", project: projectB }));
    two.sync(two.service.edit(otherID, { choices: { mode: "local", project: projectB } }));
    await two.run(two.service.flush(otherID));
    const reloaded = fixture(one.name);
    await reloaded.run(reloaded.service.hydrate("server"));
    expect(reloaded.service.choices("server").project).toEqual(projectB);
    one.sync(
      one.service.edit(id, {
        choices: { ...choices, branch: { kind: "existing", name: "feature" } },
      }),
    );
    one.sync(
      one.service.edit(id, {
        choices: {
          ...one.service.get(id)!.value.choices,
          agent: "custom",
          model: { id: "custom", providerID: "provider" },
        },
      }),
    );
    await one.run(one.service.flush(id));
    await reloaded.run(reloaded.service.hydrate("server"));
    expect(reloaded.service.choices("server").project).toEqual(projectB);
    expect(reloaded.service.choices("server", choices.project).branch).toEqual({
      kind: "existing",
      name: "feature",
    });
  });

  it("keeps empty composers unstored and reloads text, skills, files and full choices", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("built-in", choices));
    await one.run(one.service.flush(id));
    expect(one.service.get(id)?.saved).toBeUndefined();
    const file = new File(["durable file"], "review.txt", {
      type: "text/plain",
      lastModified: 100,
    });
    one.sync(
      one.service.edit(id, {
        text: "First draft",
        skills: [{ id: "testing", name: "Testing", mention: { start: 0, end: 4, text: "test" } }],
      }),
    );
    one.sync(one.service.attachFiles(id, [file]));
    await one.run(one.service.flush(id));
    const two = fixture(one.name);
    await two.run(two.service.hydrate("built-in"));
    expect(two.service.get(id)?.files).toBeUndefined();
    await two.run(two.service.open(id));
    expect(two.service.get(id)?.value).toMatchObject({
      text: "First draft",
      choices,
      skills: [{ id: "testing", name: "Testing" }],
    });
    expect(await two.service.get(id)!.files![0]!.file.text()).toBe("durable file");
    expect(two.service.get(id)!.files![0]!.file.lastModified).toBe(100);
    expect(two.service.get(id)?.value).toBe(two.service.get(id)?.saved);
  });

  it("acknowledges captured writes without losing edits typed during the write", async () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    let held = false;
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        if (mode !== "readwrite" || held) return work;
        held = true;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(work),
        );
      },
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Captured" }));
    await one.run(Deferred.await(started));
    one.sync(one.service.edit(id, { text: "Newer edit" }));
    one.sync(Deferred.succeed(release, undefined));
    await one.run(one.service.flush(id));
    expect(one.service.get(id)?.saved?.text).toBe("Newer edit");
    expect(one.service.get(id)?.saved).toBe(one.service.get(id)?.value);
  });

  it("preserves a stale editor and its files after another window deletes the record", async () => {
    let hold = false;
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        return hold && mode === "readwrite"
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(work),
            )
          : work;
      },
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Original" }));
    one.sync(one.service.attachFiles(id, [new File(["copy bytes"], "copy.txt")]));
    await one.run(one.service.flush(id));
    const two = fixture(one.name);
    await two.run(two.service.hydrate("server"));
    await two.run(two.service.open(id));
    hold = true;
    one.sync(one.service.edit(id, { text: "Local unsaved copy" }));
    await one.run(Deferred.await(started));
    await two.run(two.service.delete(id));
    hold = false;
    one.sync(Deferred.succeed(release, undefined));
    await expect(one.run(one.service.flush(id))).rejects.toBeDefined();
    expect(one.service.get(id)?.conflict).toBe(true);
    expect(one.service.get(id)?.value.text).toBe("Local unsaved copy");
    const copyID = await one.run(one.service.keepCopy(id));
    expect(copyID).toBeDefined();
    const three = fixture(one.name);
    await three.run(three.service.hydrate("server"));
    expect(three.service.get(id)).toBeUndefined();
    await three.run(three.service.open(copyID!));
    expect(three.service.get(copyID!)?.value.text).toBe("Local unsaved copy");
    expect(await three.service.get(copyID!)!.files![0]!.file.text()).toBe("copy bytes");
  });

  it("does not commit half an attachment update when a later request aborts", async () => {
    const one = fixture();
    const storage = one.runtime.runSync(Storage);
    await expect(
      one.run(
        storage.transaction<void>(["drafts", "attachments"], "readwrite", (tx) => {
          tx.store("drafts").add({ id: "half", serverKey: "server" });
          tx.store("attachments").add({ id: "duplicate" });
          tx.store("attachments").add({ id: "duplicate" });
          tx.result(undefined);
        }),
      ),
    ).rejects.toBeDefined();
    const remaining = await one.run(
      storage.transaction<unknown>(["drafts"], "readonly", (tx) =>
        tx.read(tx.store("drafts").get("half"), tx.result),
      ),
    );
    expect(remaining).toBeUndefined();
  });

  it("retains failed edits in memory and deletes saved files with their draft", async () => {
    let deny = false;
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) =>
        deny && mode === "readwrite"
          ? Effect.fail(new StorageError({ message: "Quota denied", cause: undefined }))
          : storage.transaction(stores, mode, body),
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.attachFiles(id, [new File(["bytes"], "file.txt")]));
    await one.run(one.service.flush(id));
    deny = true;
    one.sync(one.service.edit(id, { text: "Still in memory" }));
    await expect(one.run(one.service.flush(id))).rejects.toBeDefined();
    expect(one.service.get(id)?.value.text).toBe("Still in memory");
    expect(meaningfulDraft(one.service.get(id)!.value)).toBe(true);
    deny = false;
    await one.run(one.service.delete(id));
    const files = await one.run(
      one.runtime
        .runSync(Storage)
        .transaction<unknown[]>(["attachments"], "readonly", (tx) =>
          tx.read(tx.store("attachments").getAll(), tx.result),
        ),
    );
    expect(files).toEqual([]);
    expect(one.service.get(id)).toBeUndefined();
  });

  it("finishes accepted saves after a caller leaves and drains writes before shutdown", async () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    let held = false;
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        if (mode !== "readwrite" || held) return work;
        held = true;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(work),
        );
      },
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Survives caller" }));
    one.sync(one.service.attachFiles(id, [new File(["retained"], "file.txt")]));
    await one.run(Deferred.await(started));
    const waiting = one.runtime.runFork(one.service.flush(id));
    await one.run(Fiber.interrupt(waiting));
    one.service.release(id);
    expect(one.service.get(id)?.files).toHaveLength(1);
    let closed = false;
    const closing = one.runtime.dispose().then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    Effect.runSync(Deferred.succeed(release, undefined));
    await closing;
    const two = fixture(one.name);
    await two.run(two.service.hydrate("server"));
    await two.run(two.service.open(id));
    expect(two.service.get(id)?.value.text).toBe("Survives caller");
    expect(await two.service.get(id)!.files![0]!.file.text()).toBe("retained");
  });

  it("clears a cancelled load and releases bytes after an inactive draft saves", async () => {
    let hold = false;
    const started = Deferred.makeUnsafe<void>();
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) =>
        hold && mode === "readonly"
          ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          : storage.transaction(stores, mode, body),
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.attachFiles(id, [new File(["bytes"], "file.txt")]));
    one.service.release(id);
    await one.run(one.service.flush(id));
    expect(one.service.get(id)?.files).toBeUndefined();
    hold = true;
    const loading = one.runtime.runFork(one.service.open(id));
    await one.run(Deferred.await(started));
    expect(one.service.get(id)?.loading).toBe(true);
    await one.run(Fiber.interrupt(loading));
    expect(one.service.get(id)?.loading).toBe(false);
    hold = false;
    await one.run(one.service.open(id));
    expect(one.service.get(id)?.files).toHaveLength(1);
  });

  it("allows an explicit copy of a cleared saved draft", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Saved" }));
    await one.run(one.service.flush(id));
    one.sync(one.service.edit(id, { text: "" }));
    await one.run(one.service.flush(id));
    const copyID = await one.run(one.service.keepCopy(id));
    expect(copyID).toBeDefined();
    expect(one.service.get(copyID!)?.saved?.text).toBe("");
  });

  it("partitions drafts by server and merges independent preference changes from two windows", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(
      one.service.edit(id, {
        text: "Server one",
        choices: { ...choices, branch: { kind: "existing", name: "trunk" } },
      }),
    );
    await one.run(one.service.flush(id));
    const two = fixture(one.name);
    await two.run(two.service.hydrate("server"));
    const otherID = two.sync(two.service.create("server", two.service.get(id)!.value.choices));
    two.sync(
      two.service.edit(otherID, {
        choices: { ...choices, mode: "worktree", branch: { kind: "existing", name: "trunk" } },
      }),
    );
    await two.run(two.service.flush(otherID));
    one.sync(
      one.service.edit(id, {
        choices: { ...choices, branch: { kind: "existing", name: "feature" } },
      }),
    );
    await one.run(one.service.flush(id));
    const three = fixture(one.name);
    await three.run(three.service.hydrate("server"));
    expect(three.service.choices("server")).toMatchObject({
      project: choices.project,
      mode: "worktree",
      branch: { kind: "existing", name: "feature" },
    });
    const isolated = fixture(one.name);
    await isolated.run(isolated.service.hydrate("another-server"));
    expect(isolated.registry.get(isolated.service.state).size).toBe(0);
    expect(isolated.service.choices("another-server")).toEqual({
      project: undefined,
      mode: "local",
      branch: undefined,
    });
  });

  it("keeps choices made while a saved-preference refresh is pending", async () => {
    let hold = false;
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        if (!hold || mode !== "readonly" || !stores.includes("preferences")) return work;
        hold = false;
        return work.pipe(
          Effect.tap(() =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
          ),
        );
      },
    }));
    const id = one.sync(one.service.create("server", choices));
    one.sync(
      one.service.edit(id, {
        text: "Draft",
        choices: { ...choices, branch: { kind: "existing", name: "trunk" } },
      }),
    );
    await one.run(one.service.flush(id));
    // Another window changes mode before this window reads its preferences.
    await one.run(
      one.runtime.runSync(Storage).transaction(["preferences"], "readwrite", (tx) => {
        tx.store("preferences").put({
          key: JSON.stringify(["server", "/srv/project", "logical"]),
          mode: "worktree",
          branch: { kind: "existing", name: "trunk" },
        });
        tx.result(undefined);
      }),
    );
    hold = true;
    const refresh = one.runtime.runFork(one.service.hydrate("server"));
    await one.run(Deferred.await(started));
    one.sync(
      one.service.edit(id, {
        choices: { ...choices, branch: { kind: "existing", name: "feature" } },
      }),
    );
    one.sync(Deferred.succeed(release, undefined));
    await one.run(Fiber.await(refresh));
    await one.run(one.service.flush(id));
    expect(one.service.choices("server").mode).toBe("worktree");
    expect(one.service.choices("server").branch).toEqual({ kind: "existing", name: "feature" });
    const two = fixture(one.name);
    await two.run(two.service.hydrate("server"));
    expect(two.service.choices("server").branch).toEqual({ kind: "existing", name: "feature" });
  });
});

async function submitting(one = fixture()) {
  const connected = controller(one);
  const { runtime } = connected;
  connected.pending.resolve();
  const model = (await runtime.api.model.default()).data!;
  runtime.data.location.model.list = () => [model];
  vi.mocked(runtime.api.location.get).mockResolvedValue({
    directory: "/srv/project",
    project: { id: "project", directory: "/srv/project", canonical: "/srv/project" },
  });
  vi.mocked(runtime.data.session.create).mockImplementation((input) => ({
    id: input.id!,
    request: Promise.resolve(
      sessionFixture({ id: input.id!, location: input.location!, projectID: "project" }),
    ),
  }));
  vi.mocked(runtime.data.session.prompt).mockImplementation(async (input) => ({
    id: input.id!,
    sessionID: input.sessionID,
    type: "user",
    timeCreated: 1,
    delivery: input.delivery!,
    payload: { text: input.text },
  }));
  const id = one.sync(
    one.service.create("server", {
      mode: "local",
      project: { id: "project", location: { directory: "/srv/project" } },
      branch: { kind: "existing", name: "feature" },
      agent: "build",
      model: { id: model.id, providerID: model.providerID },
    }),
  );
  one.sync(one.service.edit(id, { text: "Captured first message" }));
  await one.run(one.service.flush(id));
  connected.select(id);
  await vi.waitFor(() => expect(connected.adapter.current().catalogs).toBe("ready"));
  return { ...connected, one, id };
}

describe("durable new-session Send", () => {
  it("keeps a draft editable through a failed background default refresh and recovers on retry", async () => {
    const fake = await submitting();
    const original = await fake.runtime.api.model.default();
    const pending = deferred<Awaited<ReturnType<typeof fake.runtime.api.model.default>>>();
    const settled = pending.promise.catch(() => undefined);
    fake.runtime.api.model.default = vi
      .fn<typeof fake.runtime.api.model.default>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(original);
    fake.events.emit({
      type: "config.updated",
      id: "event",
      created: 0,
      location: fake.one.service.get(fake.id)!.value.choices.project!.location,
      data: {},
    });
    try {
      await vi.waitFor(() => expect(fake.runtime.api.model.default).toHaveBeenCalledOnce());
      expect(fake.adapter.composer(fake.id).disabled).toBe(false);
      expect(fake.adapter.composer(fake.id).modelSelection.state).toBe("ready");
      expect(fake.adapter.composer(fake.id).agentSelection.state).toBe("ready");
      fake.adapter.composer(fake.id).onInput("Keep editing during refresh");
    } finally {
      pending.reject(new Error("Refresh failed"));
      await settled;
    }
    await vi.waitFor(() =>
      expect(fake.adapter.composer(fake.id).error).toContain("Models could not be loaded"),
    );
    expect(fake.adapter.composer(fake.id).disabled).toBe(false);
    expect(fake.adapter.composer(fake.id).modelSelection.state).toBe("ready");
    expect(fake.one.service.get(fake.id)?.value.text).toBe("Keep editing during refresh");
    fake.adapter.retry();
    await vi.waitFor(() => {
      expect(fake.adapter.current().catalogs).toBe("ready");
      expect(fake.adapter.composer(fake.id).error).toBeUndefined();
    });
  });

  it("preserves and submits the server's default variant without requiring a named variant", async () => {
    const fake = await submitting();
    const entry = fake.one.service.get(fake.id)!;
    fake.one.sync(
      fake.one.service.edit(fake.id, {
        choices: {
          ...entry.value.choices,
          model: { ...entry.value.choices.model!, variant: "default" },
        },
      }),
    );
    expect(fake.adapter.composer(fake.id).disabled).toBe(false);
    expect(fake.adapter.composer(fake.id).error).toBeUndefined();
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: "default-model", providerID: "provider", variant: "default" },
      }),
    );
    expect(fake.runtime.data.session.prompt).toHaveBeenCalledOnce();
  });

  it("sends attachments when navigation happens before their pending save completes", async () => {
    let holdSave = false;
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        if (!holdSave || mode !== "readwrite" || !stores.includes("attachments")) return work;
        holdSave = false;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(work),
        );
      },
    }));
    const fake = await submitting(one);
    cleanup.push(async () => {
      one.sync(Deferred.succeed(release, undefined));
    });
    holdSave = true;
    one.sync(one.service.attachFiles(fake.id, [new File(["retained bytes"], "review.txt")]));
    await one.run(Deferred.await(started));
    fake.adapter.submit(fake.id);
    fake.select(undefined);
    expect(one.service.get(fake.id)?.busy).toBe(true);
    one.sync(Deferred.succeed(release, undefined));
    await vi.waitFor(() => expect(one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.prompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        files: [
          { name: "review.txt", uri: "data:application/octet-stream;base64,cmV0YWluZWQgYnl0ZXM=" },
        ],
      }),
    );
    expect(fake.selectSession).not.toHaveBeenCalled();
  });

  it("keeps a preparation retry locked while loading commands and sends the captured invocation", async () => {
    const fake = await submitting();
    fake.runtime.data.location.command.list = () => [{ name: "review", description: "Review" }];
    fake.one.sync(fake.one.service.edit(fake.id, { text: "/review old" }));
    vi.mocked(fake.runtime.api.location.get).mockRejectedValueOnce(new Error("preparation failed"));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() =>
      expect(fake.one.service.get(fake.id)?.value.attempt?.result).toBe("failed"),
    );
    expect(fake.one.service.get(fake.id)?.value.attempt?.phase).toBe("preparing");
    const paused = deferred();
    cleanup.push(async () => paused.resolve());
    const commands = vi
      .fn<typeof fake.runtime.data.location.command.sync>()
      .mockReturnValueOnce(paused.promise)
      .mockResolvedValue(undefined);
    fake.runtime.data.location.command.sync = commands;
    vi.mocked(fake.runtime.api.session.command).mockResolvedValue(undefined);
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(commands).toHaveBeenCalledOnce());
    expect(fake.one.service.get(fake.id)?.busy).toBe(true);
    expect(fake.adapter.composer(fake.id).readOnly).toBe(true);
    fake.one.sync(fake.one.service.edit(fake.id, { text: "/review new" }));
    await fake.one.run(fake.one.service.delete(fake.id));
    fake.adapter.submit(fake.id);
    expect(fake.one.service.get(fake.id)?.value.text).toBe("/review old");
    expect(commands).toHaveBeenCalledOnce();
    paused.resolve();
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.api.session.command).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ command: "review", text: "old" }),
      { signal: expect.any(AbortSignal) },
    );
    expect(fake.runtime.data.session.create).toHaveBeenCalledOnce();
  });

  it("captures input once, locks edits immediately, and completes in the background without selecting", async () => {
    const fake = await submitting();
    const created = deferred<ReturnType<typeof sessionFixture>>();
    cleanup.push(async () => {
      created.resolve(
        sessionFixture({
          id: fake.one.service.get(fake.id)?.value.attempt?.sessionID ?? "unused",
          location: { directory: "/srv/project" },
        }),
      );
    });
    vi.mocked(fake.runtime.data.session.create).mockImplementation((input) => ({
      id: input.id!,
      request: created.promise,
    }));
    fake.adapter.submit(fake.id);
    fake.adapter.submit(fake.id);
    fake.one.sync(fake.one.service.edit(fake.id, { text: "Late edit" }));
    await vi.waitFor(() => expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1));
    const attempt = fake.one.service.get(fake.id)!.value.attempt!;
    expect(attempt.phase).toBe("creating");
    expect(fake.one.service.get(fake.id)!.value.text).toBe("Captured first message");
    fake.select(undefined);
    created.resolve(
      sessionFixture({ id: attempt.sessionID, location: { directory: "/srv/project" } }),
    );
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: attempt.sessionID, text: "Captured first message" }),
    );
    expect(fake.selectSession).not.toHaveBeenCalled();
  });

  it("retries a failed prompt with the same session, message ID, and persisted file bytes", async () => {
    const fake = await submitting();
    fake.one.sync(
      fake.one.service.attachFiles(fake.id, [
        new File(["durable bytes"], "proof.txt", { type: "text/plain" }),
      ]),
    );
    vi.mocked(fake.runtime.data.session.prompt).mockRejectedValueOnce(new Error("response lost"));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() =>
      expect(fake.one.service.get(fake.id)?.value.attempt?.result).toBe("failed"),
    );
    const first = vi.mocked(fake.runtime.data.session.prompt).mock.calls[0]![0];
    vi.mocked(fake.runtime.api.session.message).mockRejectedValueOnce(new Error("not found"));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.runtime.data.session.prompt).mock.calls[1]![0]).toEqual(first);
    expect(fake.selectSession).toHaveBeenCalledWith(first.sessionID);
  });

  it("checks uncertain creation without repeating create or sending automatically", async () => {
    const fake = await submitting();
    vi.mocked(fake.runtime.data.session.create).mockImplementationOnce((input) => ({
      id: input.id!,
      request: Promise.reject(new Error("response lost")),
    }));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() =>
      expect(fake.one.service.get(fake.id)?.value.attempt?.result).toBe("failed"),
    );
    const attempt = fake.one.service.get(fake.id)!.value.attempt!;
    expect(fake.adapter.composer(fake.id).disabled).toBe(true);
    vi.mocked(fake.runtime.api.session.get).mockResolvedValue(
      sessionFixture({ id: attempt.sessionID, location: { directory: "/srv/project" } }),
    );
    fake.adapter.checkSession(fake.id);
    await vi.waitFor(() =>
      expect(fake.one.service.get(fake.id)?.value.attempt?.confirmed).toBe(true),
    );
    expect(fake.runtime.data.session.prompt).not.toHaveBeenCalled();
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1);
  });

  it("does not replay an uncertain command", async () => {
    const fake = await submitting();
    const command = { name: "review", description: "Review" };
    fake.runtime.data.location.command.list = () => [command];
    fake.one.sync(fake.one.service.edit(fake.id, { text: "/review changes" }));
    vi.mocked(fake.runtime.api.session.command).mockRejectedValueOnce(new Error("response lost"));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() =>
      expect(fake.one.service.get(fake.id)?.value.attempt?.result).toBe("failed"),
    );
    expect(fake.adapter.composer(fake.id).disabled).toBe(true);
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)?.busy).toBe(false));
    expect(fake.runtime.api.session.command).toHaveBeenCalledTimes(1);
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1);
    expect(fake.runtime.data.session.prompt).not.toHaveBeenCalled();
  });

  it("uses a native lock across two draft services and does not mark a live owner interrupted", async () => {
    const fake = await submitting();
    const held = deferred<ReturnType<typeof sessionFixture>>();
    cleanup.push(async () => {
      held.resolve(
        sessionFixture({
          id: fake.one.service.get(fake.id)?.value.attempt?.sessionID ?? "unused",
          location: { directory: "/srv/project" },
        }),
      );
    });
    vi.mocked(fake.runtime.data.session.create).mockImplementationOnce((input) => ({
      id: input.id!,
      request: held.promise,
    }));
    const second = fixture(fake.one.name);
    await second.run(second.service.hydrate("server"));
    await second.run(second.service.open(fake.id));
    const other = controller(second);
    other.pending.resolve();
    other.select(fake.id);
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1));
    await second.run(second.service.hydrate("server"));
    expect(second.service.get(fake.id)?.value.attempt?.result).toBeUndefined();
    await vi.waitFor(() => expect(second.service.get(fake.id)?.files).toBeDefined());
    await expect(
      second.run(withBrowserLock(draftLockName("server", fake.id), Effect.void, true)),
    ).rejects.toThrow("another window");
    expect(other.adapter.composer(fake.id).disabled).toBe(true);
    other.adapter.submit(fake.id);
    expect(other.runtime.data.session.create).not.toHaveBeenCalled();
    const attempt = fake.one.service.get(fake.id)!.value.attempt!;
    held.resolve(
      sessionFixture({ id: attempt.sessionID, location: { directory: "/srv/project" } }),
    );
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
  });

  it("restores an abandoned attempt as interrupted without performing server work", async () => {
    const one = fixture();
    const id = one.sync(one.service.create("server", choices));
    one.sync(one.service.edit(id, { text: "Never autoresubmit" }));
    await one.run(
      one.service.beginSubmission(id, {
        sessionID: "known-session",
        phase: "sending",
        confirmed: true,
        location: choices.project.location,
        request: { kind: "prompt", id: "known-message" },
      }),
    );
    const next = fixture(one.name);
    await next.run(next.service.hydrate("server"));
    expect(next.service.get(id)?.value.attempt).toMatchObject({
      sessionID: "known-session",
      result: "interrupted",
      request: { id: "known-message" },
    });
    next.sync(next.service.edit(id, { text: "Cannot overwrite frozen payload" }));
    expect(next.service.get(id)?.value.text).toBe("Never autoresubmit");
    await next.run(next.service.open(id));
    const copyID = await next.run(next.service.keepCopy(id));
    expect(next.service.get(copyID!)?.value.attempt).toBeUndefined();
  });
  it("holds same-project preparation through first-message admission", async () => {
    const fake = await submitting();
    const firstMessage = deferred<Awaited<ReturnType<typeof fake.runtime.data.session.prompt>>>();
    cleanup.push(async () => {
      firstMessage.resolve({
        id: "unused",
        sessionID: "unused",
        type: "user",
        timeCreated: 1,
        delivery: "steer",
        payload: { text: "unused" },
      });
    });
    vi.mocked(fake.runtime.data.session.prompt).mockImplementationOnce(() => firstMessage.promise);
    const secondID = fake.one.sync(
      fake.one.service.create("server", fake.one.service.get(fake.id)!.value.choices),
    );
    fake.one.sync(fake.one.service.edit(secondID, { text: "Second queued draft" }));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.runtime.data.session.prompt).toHaveBeenCalledTimes(1));
    fake.adapter.submit(secondID);
    await vi.waitFor(() =>
      expect(fake.one.service.get(secondID)?.value.attempt?.phase).toBe("preparing"),
    );
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1);
    const input = vi.mocked(fake.runtime.data.session.prompt).mock.calls[0]![0];
    firstMessage.resolve({
      id: input.id!,
      sessionID: input.sessionID,
      type: "user",
      timeCreated: 1,
      delivery: "steer",
      payload: { text: input.text },
    });
    await vi.waitFor(() => expect(fake.one.service.get(secondID)).toBeUndefined());
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(2);
  });

  it("retains an SDK create request on workspace shutdown and never proceeds to Send", async () => {
    const fake = await submitting();
    const create = deferred<ReturnType<typeof sessionFixture>>();
    cleanup.push(async () => {
      create.resolve(
        sessionFixture({
          id: fake.one.service.get(fake.id)?.value.attempt?.sessionID ?? "unused",
          location: { directory: "/srv/project" },
        }),
      );
    });
    vi.mocked(fake.runtime.data.session.create).mockImplementationOnce((input) => ({
      id: input.id!,
      request: create.promise,
    }));
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = Effect.runPromise(Scope.close(fake.runtime.effects.scope, Exit.void)).then(
      () => {
        closed = true;
        return undefined;
      },
    );
    await Promise.resolve();
    expect(closed).toBe(false);
    const sessionID = fake.one.service.get(fake.id)!.value.attempt!.sessionID;
    create.resolve(sessionFixture({ id: sessionID, location: { directory: "/srv/project" } }));
    await closing;
    expect(fake.runtime.data.session.prompt).not.toHaveBeenCalled();
    expect(fake.one.service.get(fake.id)?.value.attempt).toMatchObject({
      phase: "creating",
      result: "interrupted",
      sessionID,
    });
  });

  it("retries only local cleanup after admission when storage deletion fails", async () => {
    let failDelete = false;
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) =>
        failDelete && mode === "readwrite" && stores.includes("attachments")
          ? Effect.fail(new StorageError({ message: "Disk unavailable", cause: undefined }))
          : storage.transaction(stores, mode, body),
    }));
    const fake = await submitting(one);
    vi.mocked(fake.runtime.data.session.prompt).mockImplementationOnce(async (input) => {
      failDelete = true;
      return {
        id: input.id!,
        sessionID: input.sessionID,
        type: "user",
        timeCreated: 1,
        delivery: "steer",
        payload: { text: input.text },
      };
    });
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(one.service.get(fake.id)?.value.attempt?.result).toBe("failed"));
    expect(one.service.get(fake.id)?.value.attempt?.phase).toBe("accepted");
    failDelete = false;
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(one.service.get(fake.id)).toBeUndefined());
    expect(fake.runtime.data.session.create).toHaveBeenCalledTimes(1);
    expect(fake.runtime.data.session.prompt).toHaveBeenCalledTimes(1);
  });
  it("does not share captured model or location objects with the SDK's optimistic store", async () => {
    const fake = await submitting();
    const original = fake.one.service.get(fake.id)!.value.choices.model!;
    vi.mocked(fake.runtime.data.session.create).mockImplementationOnce((input) => {
      input.model!.id = "SDK updated model";
      input.location!.directory = "/SDK/updated/location";
      return {
        id: input.id!,
        request: Promise.resolve(
          sessionFixture({ id: input.id!, location: { directory: "/srv/project" } }),
        ),
      };
    });
    fake.adapter.submit(fake.id);
    await vi.waitFor(() => expect(fake.one.service.get(fake.id)).toBeUndefined());
    expect(original.id).toBe("default-model");
    expect(fake.runtime.data.session.prompt).toHaveBeenCalledTimes(1);
  });
  it("keeps the draft lock until an interrupted capture commit settles", async () => {
    let holdCapture = false;
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const one = fixture(undefined, (storage) => ({
      transaction: (stores, mode, body) => {
        const work = storage.transaction(stores, mode, body);
        if (!holdCapture || mode !== "readwrite" || stores.length !== 1 || stores[0] !== "drafts")
          return work;
        holdCapture = false;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(work),
        );
      },
    }));
    const fake = await submitting(one);
    cleanup.push(async () => {
      one.sync(Deferred.succeed(release, undefined));
    });
    holdCapture = true;
    fake.adapter.submit(fake.id);
    await one.run(Deferred.await(started));
    const closing = Effect.runPromise(Scope.close(fake.runtime.effects.scope, Exit.void));
    await expect(
      one.run(withBrowserLock(draftLockName("server", fake.id), Effect.void, true)),
    ).rejects.toThrow("another window");
    one.sync(Deferred.succeed(release, undefined));
    await closing;
    expect(one.service.get(fake.id)?.value.attempt?.result).toBe("interrupted");
    expect(fake.runtime.data.session.create).not.toHaveBeenCalled();
  });
});
