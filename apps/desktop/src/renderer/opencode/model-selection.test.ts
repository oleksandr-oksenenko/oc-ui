import { OpenCode, type LocationRef, type ModelInfo, type SessionInfo } from "@opencode/client";
import { createData } from "@opencode/client/solid";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { deferred } from "../test/deferred.ts";
import { sessionFixture } from "../test/session-fixture.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { createOpenCodeEventSource } from "./event-source.ts";
import { createModelCatalog } from "./model-catalog.ts";
import { modelChoiceID } from "./model-choices.ts";
import { createModelSelection } from "./model-selection.ts";

const location = { directory: "/project" };
const worktree = { directory: "/worktree", workspaceID: "workspace-one" };
const otherWorkspace = { ...worktree, workspaceID: "workspace-two" };
type Input = Parameters<typeof createModelSelection>[0];

function model(id: string, context = 32_768, variants: readonly string[] = []): ModelInfo {
  return {
    id,
    modelID: id,
    providerID: "provider",
    name: id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: variants.map((variantID) => ({ id: variantID })),
    time: { released: 1 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context, output: 2048 },
  };
}
const ref = (info: ModelInfo, variant?: string) => ({
  id: info.id,
  providerID: info.providerID,
  variant,
});
const response = (target: LocationRef, data: ModelInfo | null) => ({
  location: {
    ...target,
    project: { id: "project", directory: target.directory, canonical: location.directory },
  },
  data,
});
function session(id = "session", target = location, selected?: SessionInfo["model"]) {
  return sessionFixture({ id, location: target, model: selected });
}

function setup(
  options: {
    selected?: SessionInfo;
    empty?: boolean;
    catalogs?: ReadonlyMap<string, readonly ModelInfo[]>;
    default?: Input["api"]["model"]["default"];
    syncModels?: Input["data"]["location"]["model"]["sync"];
    activate?: Input["api"]["plugin"]["awaitActivation"];
    switchModel?: Input["api"]["session"]["switchModel"];
    syncSession?: Input["data"]["session"]["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const events = createOpenCodeEventSource();
    const [selectedSession, select] = createSignal<SessionInfo | undefined>(
      options.empty ? undefined : (options.selected ?? session()),
    );
    const [connected, setConnected] = createSignal(true);
    const [catalogs, setCatalogs] = createSignal(
      options.catalogs ?? new Map([[JSON.stringify(location), [model("one")]]]),
    );
    const persisted = new Map<string, SessionInfo>();
    const initial = selectedSession();
    if (initial) persisted.set(initial.id, initial);
    const syncModels = vi.fn<Input["data"]["location"]["model"]["sync"]>(
      options.syncModels ?? (async () => undefined),
    );
    const invalidateModels = vi.fn<Input["data"]["location"]["model"]["invalidate"]>();
    const syncSession = vi.fn<Input["data"]["session"]["sync"]>(
      options.syncSession ??
        (async (id) => {
          if (selectedSession()?.id === id) select(persisted.get(id));
        }),
    );
    const invalidateSession = vi.fn<Input["data"]["session"]["invalidate"]>();
    const api: Input["api"] = {
      plugin: {
        awaitActivation: vi.fn<Input["api"]["plugin"]["awaitActivation"]>(
          options.activate ?? (async () => undefined),
        ),
      },
      model: {
        default: vi.fn<Input["api"]["model"]["default"]>(
          options.default ??
            (async (input) => {
              const target = {
                directory: input?.location?.directory ?? location.directory,
                workspaceID: input?.location?.workspace,
              };
              const listed =
                catalogs().get(JSON.stringify(target)) ??
                catalogs().get(JSON.stringify({ directory: target.directory }));
              return response(target, listed?.find((item) => item.enabled) ?? null);
            }),
        ),
      },
      session: {
        switchModel: vi.fn<Input["api"]["session"]["switchModel"]>(
          options.switchModel ??
            (async ({ sessionID, model: reference }) => {
              const previous = persisted.get(sessionID);
              if (previous) persisted.set(sessionID, { ...previous, model: reference });
            }),
        ),
      },
    };
    const data: Input["data"] = {
      on: events.on,
      location: {
        model: {
          list: (target) => {
            const listed = catalogs().get(JSON.stringify(target));
            return listed ? [...listed] : undefined;
          },
          sync: syncModels,
          invalidate: invalidateModels,
        },
      },
      session: {
        sync: syncSession,
        invalidate: invalidateSession,
        get: (id) => persisted.get(id)!,
      },
    };
    const selection = createModelSelection({ effects, api, data, selectedSession, connected });
    return {
      selection,
      api,
      data,
      events,
      select,
      setConnected,
      setCatalogs,
      persisted,
      syncModels,
      invalidateModels,
      syncSession,
      invalidateSession,
      dispose,
      close: () => Effect.runPromise(Scope.close(effects.scope, Exit.void)),
    };
  });
}

describe("model selection", () => {
  it("settles an empty selection without discovering the connection's location", async () => {
    const fixture = setup({ empty: true });
    await fixture.selection.sync();
    expect(fixture.selection.state()).toBe("ready");
    expect(fixture.selection.models()).toEqual([]);
    expect(fixture.api.model.default).not.toHaveBeenCalled();
    expect(fixture.syncModels).not.toHaveBeenCalled();
  });

  it("reports failed discovery and allows an explicit retry", async () => {
    const fixture = setup({
      syncModels: async () => {
        throw new Error("offline");
      },
    });
    await expect(fixture.selection.sync()).rejects.toMatchObject({ cause: { message: "offline" } });
    expect(fixture.selection.state()).toBe("failed");
    expect(fixture.selection.error()).toBe(
      "Models could not be loaded. Check the connection and try again.",
    );
    fixture.syncModels.mockResolvedValue(undefined);
    await fixture.selection.sync();
    expect(fixture.selection.state()).toBe("ready");
    expect(fixture.selection.error()).toBeUndefined();
  });

  it("uses full session locations for models, variants, defaults and context limits", async () => {
    const a = model("shared", 32_768, ["fast"]);
    const b = model("shared", 131_072, ["deep"]);
    const c = model("custom", 65_536);
    const fixture = setup({
      catalogs: new Map([
        [JSON.stringify(location), [a, { ...model("disabled"), enabled: false }]],
        [JSON.stringify(worktree), [b]],
        [JSON.stringify(otherWorkspace), [c]],
      ]),
    });
    await fixture.selection.sync();
    expect(fixture.selection.models().map((item) => item.label)).toEqual(["shared"]);
    expect(fixture.selection.contextLimit()).toBe(32_768);
    fixture.select(session("worktree", worktree, ref(b, "deep")));
    await fixture.selection.sync();
    expect(fixture.syncModels).toHaveBeenLastCalledWith(worktree);
    expect(fixture.api.model.default).toHaveBeenLastCalledWith(
      { location: { directory: worktree.directory, workspace: worktree.workspaceID } },
      { signal: expect.any(AbortSignal) },
    );
    expect(fixture.api.plugin.awaitActivation).toHaveBeenLastCalledWith(
      { location: { directory: worktree.directory, workspace: worktree.workspaceID } },
      { signal: expect.any(AbortSignal) },
    );
    expect(fixture.selection.contextLimit()).toBe(131_072);
    expect(fixture.selection.variants().map((item) => item.id)).toEqual(["deep"]);
    expect(fixture.selection.selectedVariantID()).toBe("deep");
    fixture.select(session("worktree", otherWorkspace));
    await fixture.selection.sync();
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(c));
    expect(fixture.selection.contextLimit()).toBe(65_536);
  });

  it("awaits activation and shares a pending read, then cancels real I/O and drains it on shutdown", async () => {
    const activated = deferred();
    const pending = deferred();
    let signal: AbortSignal | undefined;
    const fixture = setup({
      activate: () => activated.promise,
      default: async (_input, options) => {
        signal = options?.signal;
        await pending.promise;
        return response(location, null);
      },
    });
    const reads = Promise.allSettled([fixture.selection.sync(), fixture.selection.sync()]);
    expect(fixture.syncModels).not.toHaveBeenCalled();
    activated.resolve();
    await vi.waitFor(() => expect(fixture.api.model.default).toHaveBeenCalledOnce());
    expect(fixture.syncModels).toHaveBeenCalledOnce();
    const closed = vi.fn<() => void>();
    const shutdown = fixture.close().then(closed);
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).not.toHaveBeenCalled();
    pending.resolve();
    await shutdown;
    expect((await reads).map((item) => item.status)).toEqual(["rejected", "rejected"]);
  });

  it("keeps same-named models from different providers distinct", async () => {
    const first = model("shared");
    const second = { ...model("shared", 100_000), providerID: "other-provider" };
    const fixture = setup({
      selected: session("session", location, ref(second)),
      catalogs: new Map([[JSON.stringify(location), [first, second]]]),
    });
    await fixture.selection.sync();
    expect(fixture.selection.models().map((item) => item.id)).toEqual([
      modelChoiceID(first),
      modelChoiceID(second),
    ]);
    expect(fixture.selection.contextLimit()).toBe(100_000);
    await fixture.selection.selectModel(modelChoiceID(first));
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(first));
  });

  it("refreshes a changed default on configuration events without replacing an explicit selection", async () => {
    const first = model("one");
    const second = model("two");
    const fixture = setup({ catalogs: new Map([[JSON.stringify(location), [first, second]]]) });
    await fixture.selection.sync();
    vi.mocked(fixture.api.model.default).mockResolvedValue(response(location, second));
    fixture.events.emit({ type: "config.updated", id: "event", created: 0, location, data: {} });
    await fixture.selection.sync();
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(second));
    fixture.select(session("session", location, ref(first)));
    fixture.events.emit({ type: "config.updated", id: "event", created: 0, location, data: {} });
    await fixture.selection.sync();
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(first));
  });

  it.each(["success", "failure"])(
    "preserves an implicit default and context during background refresh %s",
    async (outcome) => {
      const first = model("one");
      const second = model("two", 100_000);
      const fixture = setup({ catalogs: new Map([[JSON.stringify(location), [first, second]]]) });
      await fixture.selection.sync();
      const pending = deferred<Awaited<ReturnType<Input["api"]["model"]["default"]>>>();
      vi.mocked(fixture.api.model.default).mockReturnValueOnce(pending.promise);
      fixture.events.emit({ type: "config.updated", id: "event", created: 0, location, data: {} });
      const refreshed = Promise.allSettled([fixture.selection.sync()]);
      try {
        await vi.waitFor(() => expect(fixture.api.model.default).toHaveBeenCalledTimes(2));
        expect(fixture.selection.state()).toBe("ready");
        expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(first));
        expect(fixture.selection.contextLimit()).toBe(32_768);
      } finally {
        if (outcome === "success") pending.resolve(response(location, second));
        else pending.reject(new Error("refresh failed"));
        await refreshed;
      }
      expect(fixture.selection.state()).toBe("ready");
      const expectedModel = outcome === "success" ? second : first;
      expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(expectedModel));
      expect(fixture.selection.contextLimit()).toBe(expectedModel.limit.context);
      expect(fixture.selection.error()).toBe(
        outcome === "success"
          ? undefined
          : "Models could not be loaded. Check the connection and try again.",
      );
      await fixture.selection.sync();
      expect(fixture.selection.error()).toBeUndefined();
    },
  );

  it("reuses SDK catalogs across navigation and refetches for explicit refresh and catalog events", async () => {
    const fixture = withTestWorkspace((effects) => {
      const events = createOpenCodeEventSource();
      const api = OpenCode.make({ baseUrl: "http://model-catalog.test" });
      vi.spyOn(api.plugin, "awaitActivation").mockResolvedValue(undefined);
      vi.spyOn(api.model, "default").mockResolvedValue(response(location, model("one")));
      const list = vi.spyOn(api.model, "list").mockResolvedValue({
        ...response(location, null),
        data: [model("one")],
      });
      vi.spyOn(api.provider, "list").mockResolvedValue({ ...response(location, null), data: [] });
      const data = createData({ api: () => api, directory: location.directory, event: events });
      const [target, select] = createSignal<LocationRef | undefined>(location);
      const catalog = createModelCatalog({
        effects,
        api,
        data,
        location: target,
        connected: () => true,
      });
      return { catalog, select, list, events };
    });
    await fixture.catalog.sync();
    fixture.select(worktree);
    await fixture.catalog.sync();
    fixture.select(location);
    await fixture.catalog.sync();
    fixture.select(undefined);
    await fixture.catalog.sync();
    fixture.select(location);
    await fixture.catalog.sync();
    expect(fixture.list.mock.calls.map(([input]) => input?.location?.directory)).toEqual([
      location.directory,
      worktree.directory,
    ]);
    await fixture.catalog.sync();
    expect(fixture.list).toHaveBeenCalledTimes(3);
    fixture.events.emit({ type: "catalog.updated", id: "event", created: 0, location, data: {} });
    await fixture.catalog.sync();
    expect(fixture.list).toHaveBeenCalledTimes(4);
  });

  it("suppresses old-location defaults and failures after navigation and reconnect", async () => {
    const oldRead = deferred();
    let signal: AbortSignal | undefined;
    const fixture = setup({
      catalogs: new Map([
        [JSON.stringify(location), [model("one")]],
        [JSON.stringify(worktree), [model("two")]],
      ]),
      default: async (input, options) => {
        if (input?.location?.directory === location.directory) {
          signal = options?.signal;
          await oldRead.promise;
        }
        return response(worktree, model("two"));
      },
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    fixture.select(session("two", worktree));
    await fixture.selection.sync();
    expect(signal?.aborted).toBe(true);
    oldRead.reject(new Error("obsolete"));
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(model("two")));
    expect(fixture.selection.error()).toBeUndefined();
    fixture.setConnected(false);
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("failed"));
    fixture.setConnected(true);
    await fixture.selection.sync();
    expect(fixture.selection.state()).toBe("ready");
  });

  it("follows SDK catalog updates and refreshes the default only for relevant events", async () => {
    const fixture = setup();
    await fixture.selection.sync();
    fixture.setCatalogs(new Map([[JSON.stringify(location), [model("new", 100_000, ["deep"])]]]));
    fixture.events.emit({
      type: "catalog.updated",
      id: "event",
      created: 0,
      location: worktree,
      data: {},
    });
    expect(fixture.api.model.default).toHaveBeenCalledOnce();
    fixture.events.emit({ type: "catalog.updated", id: "event", created: 0, location, data: {} });
    await fixture.selection.sync();
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(model("new")));
    expect(fixture.selection.contextLimit()).toBe(100_000);
    fixture.dispose();
    const calls = vi.mocked(fixture.api.model.default).mock.calls.length;
    fixture.events.emit({ type: "catalog.updated", id: "event", created: 0, location, data: {} });
    expect(fixture.api.model.default).toHaveBeenCalledTimes(calls);
  });

  it("preserves unavailable references and treats default as a valid baseline variant", async () => {
    const available = model("one", 32_768, ["deep"]);
    const fixture = setup({
      catalogs: new Map([[JSON.stringify(location), [available]]]),
      selected: session("session", location, ref(available, "default")),
    });
    await fixture.selection.sync();
    expect(fixture.selection.error()).toBeUndefined();
    fixture.select(session("session", location, ref(available, "missing")));
    expect(fixture.selection.selectedVariantID()).toBe("missing");
    expect(fixture.selection.error()).toContain("variant is unavailable");
    fixture.select(session("session", location, ref(model("missing"))));
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(model("missing")));
    expect(fixture.selection.error()).toContain("model is unavailable");
    expect(fixture.selection.contextLimit()).toBeUndefined();
  });

  it("retains explicit model identity when its catalog disappears and reappears", async () => {
    const available = model("one");
    const fixture = setup({
      selected: session("session", location, ref(available)),
      catalogs: new Map([[JSON.stringify(location), []]]),
    });
    await fixture.selection.sync();
    expect(fixture.selection.models()).toEqual([]);
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(available));
    expect(fixture.selection.contextLimit()).toBeUndefined();
    fixture.setCatalogs(new Map([[JSON.stringify(location), [available]]]));
    expect(fixture.selection.models().map((choice) => choice.label)).toEqual(["one"]);
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(available));
    expect(fixture.selection.contextLimit()).toBe(available.limit.context);
    fixture.setCatalogs(new Map([[JSON.stringify(location), []]]));
    expect(fixture.selection.models()).toEqual([]);
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(available));
    expect(fixture.selection.contextLimit()).toBeUndefined();
  });

  it("switches only offered choices, suppresses duplicates and invalidates before reconciliation", async () => {
    const pending = deferred();
    const available = model("one", 32_768, ["deep"]);
    const fixture = setup({
      catalogs: new Map([[JSON.stringify(location), [available]]]),
      selected: session("session", location, ref(available)),
      switchModel: () => pending.promise,
    });
    await fixture.selection.sync();
    const first = fixture.selection.selectVariant("deep");
    await fixture.selection.selectModel(modelChoiceID(available));
    await fixture.selection.selectVariant("invented");
    await fixture.selection.selectModel("invented");
    expect(fixture.api.session.switchModel).toHaveBeenCalledOnce();
    expect(fixture.selection.switching()).toBe(true);
    pending.resolve();
    await first;
    expect(fixture.invalidateSession).toHaveBeenCalledWith("session");
    expect(fixture.invalidateSession.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.syncSession.mock.invocationCallOrder[0]!,
    );
    expect(fixture.selection.switching()).toBe(false);
  });

  it("reconciles an applied mutation whose response was lost without retrying it", async () => {
    const fixture = setup();
    await fixture.selection.sync();
    vi.mocked(fixture.api.session.switchModel).mockImplementation(
      async ({ sessionID, model: reference }) => {
        fixture.persisted.set(sessionID, session(sessionID, location, reference));
        throw new Error("lost acknowledgement");
      },
    );
    await fixture.selection.selectModel(modelChoiceID(model("one")));
    expect(fixture.selection.error()).toBeUndefined();
    expect(fixture.selection.selectedModelID()).toBe(modelChoiceID(model("one")));
    expect(fixture.api.session.switchModel).toHaveBeenCalledOnce();
  });

  it("reports an unapplied mutation after reconciliation and allows a deliberate retry", async () => {
    const fixture = setup();
    await fixture.selection.sync();
    vi.mocked(fixture.api.session.switchModel).mockRejectedValueOnce(new Error("rejected"));
    await fixture.selection.selectModel(modelChoiceID(model("one")));
    expect(fixture.selection.error()).toBe("The model could not be changed. Try again.");
    expect(fixture.api.session.switchModel).toHaveBeenCalledOnce();
    await fixture.selection.selectModel(modelChoiceID(model("one")));
    expect(fixture.selection.error()).toBeUndefined();
    expect(fixture.api.session.switchModel).toHaveBeenCalledTimes(2);
  });

  it("reports partial refresh failure and discards a failure from a previous visit", async () => {
    const fixture = setup({
      syncSession: async () => {
        throw new Error("offline");
      },
    });
    await fixture.selection.sync();
    await fixture.selection.selectModel(modelChoiceID(model("one")));
    expect(fixture.selection.error()).toBe(
      "The selection changed, but its current value could not be refreshed.",
    );
    const pending = deferred();
    vi.mocked(fixture.api.session.switchModel).mockReturnValue(pending.promise);
    const switching = fixture.selection.selectModel(modelChoiceID(model("one")));
    fixture.select(session("two"));
    fixture.select(session());
    pending.reject(new Error("old visit"));
    await switching;
    expect(fixture.selection.error()).toBeUndefined();
  });

  it("retains accepted mutations through disposal and settles them during workspace shutdown", async () => {
    const pending = deferred();
    const fixture = setup({ switchModel: () => pending.promise });
    await fixture.selection.sync();
    const switching = fixture.selection.selectModel(modelChoiceID(model("one")));
    fixture.dispose();
    pending.resolve();
    await switching;
    expect(fixture.syncSession).toHaveBeenCalledOnce();
    const stopped = setup({ switchModel: () => pending.promise });
    await stopped.selection.sync();
    const secondPending = deferred();
    vi.mocked(stopped.api.session.switchModel).mockReturnValue(secondPending.promise);
    const interrupted = stopped.selection
      .selectModel(modelChoiceID(model("one")))
      .catch(() => undefined);
    const close = stopped.close();
    expect(vi.mocked(stopped.api.session.switchModel).mock.calls[0]?.[1]?.signal?.aborted).toBe(
      true,
    );
    secondPending.reject(new Error("cancelled"));
    await Promise.all([interrupted, close]);
    expect(stopped.syncSession).not.toHaveBeenCalled();
    expect(stopped.selection.switching()).toBe(false);
    expect(stopped.selection.error()).toBeUndefined();
  });
});
