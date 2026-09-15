import { withTestWorkspace } from "../test/workspace.ts";
import type { ModelInfo, OpenCodeClient, SessionInfo } from "@opencode-ai/client";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../test/deferred.ts";
import { sessionFixture } from "../test/session-fixture.ts";
import { createModelSelection } from "./model-selection.ts";

const location = { directory: "/workspace" } as const;
const responseLocation = {
  directory: "/workspace",
  project: { id: "project", directory: "/workspace", canonical: "/workspace" },
} as const;
type SelectionInput = Parameters<typeof createModelSelection>[0];
type SelectionApi = SelectionInput["api"] & {
  readonly model: Pick<OpenCodeClient["model"], "list" | "default">;
};
type SelectionData = SelectionInput["data"];

function model(input: {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants?: readonly string[];
  readonly enabled?: boolean;
  readonly contextLimit?: number;
}): ModelInfo {
  return {
    id: input.id,
    modelID: input.id,
    providerID: input.providerID,
    name: input.name,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: (input.variants ?? []).map((id) => ({ id })),
    time: { released: 1 },
    cost: [],
    status: "active",
    enabled: input.enabled ?? true,
    limit: { context: input.contextLimit ?? 1, output: 1 },
  };
}

function session(id: string, selected?: SessionInfo["model"]): SessionInfo {
  return sessionFixture({
    id,
    model: selected,
    location,
  });
}

function data(api: SelectionApi, sync: SelectionData["session"]["sync"]): SelectionData {
  const [models, setModels] = createSignal<ModelInfo[]>();
  return {
    session: { sync },
    location: {
      model: {
        list: models,
        sync: async () => {
          setModels((await api.model.list({ location })).data);
        },
        invalidate: () => undefined,
      },
    },
  };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe("model selection", () => {
  it("exposes a failed catalog load without inventing choices", async () => {
    const api: SelectionApi = {
      model: {
        list: vi.fn<SelectionApi["model"]["list"]>(() => Promise.reject(new Error("offline"))),
        default: vi.fn<SelectionApi["model"]["default"]>(() =>
          Promise.resolve({ location: responseLocation, data: null }),
        ),
      },
      session: {
        switchModel: vi.fn<SelectionApi["session"]["switchModel"]>(() => Promise.resolve()),
      },
    };
    const root = withTestWorkspace((effects, dispose) => ({
      dispose,
      selection: createModelSelection({
        effects,
        api,
        data: data(
          api,
          vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve()),
        ),
        defaultLocation: location,
        selectedSession: () => undefined,
      }),
    }));

    await expect(root.selection.sync()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "offline" }),
    });
    expect(root.selection.state()).toBe("failed");
    expect(root.selection.models()).toEqual([]);
    expect(root.selection.error()).toBe(
      "Models could not be loaded. Check the connection and try again.",
    );
    vi.mocked(api.model.list).mockResolvedValue({ location: responseLocation, data: [] });
    await root.selection.sync();
    expect(root.selection.state()).toBe("ready");
    expect(root.selection.error()).toBeUndefined();
    expect(api.model.list).toHaveBeenCalledTimes(2);
    root.dispose();
  });

  it("retains shared catalog work through view unmount and awaits it during workspace shutdown", async () => {
    const catalog = deferred();
    const fallback = deferred<Awaited<ReturnType<SelectionApi["model"]["default"]>>>();
    let requestSignal: AbortSignal | undefined;
    const loadDefault = vi.fn<SelectionApi["model"]["default"]>((_, options) => {
      requestSignal = options?.signal;
      return fallback.promise;
    });
    const syncCatalog = vi.fn<SelectionData["location"]["model"]["sync"]>(() => catalog.promise);
    const root = withTestWorkspace((effects, dispose) => ({
      dispose,
      close: () => Effect.runPromise(Scope.close(effects.scope, Exit.void)),
      selection: createModelSelection({
        effects,
        api: { model: { default: loadDefault }, session: { switchModel: async () => undefined } },
        data: {
          location: { model: { list: () => [], sync: syncCatalog, invalidate: () => undefined } },
          session: { sync: async () => undefined },
        },
        defaultLocation: location,
        selectedSession: () => undefined,
      }),
    }));
    const reads = Promise.allSettled([root.selection.sync(), root.selection.sync()]);
    expect(loadDefault).toHaveBeenCalledOnce();
    expect(syncCatalog).toHaveBeenCalledOnce();
    root.dispose();
    expect(requestSignal?.aborted).toBe(false);
    let closed = false;
    const shutdown = root.close().finally(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(requestSignal?.aborted).toBe(true));
    fallback.resolve({ location: responseLocation, data: null });
    await Promise.resolve();
    expect(closed).toBe(false);
    catalog.resolve();
    await shutdown;
    expect((await reads).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });

  it("loads the location catalog and follows session-over-default selection", async () => {
    const fallback = model({ id: "gpt", providerID: "openai", name: "GPT", contextLimit: 128_000 });
    const claude = model({
      id: "claude",
      providerID: "anthropic",
      name: "Claude",
      variants: ["fast", "deep"],
      contextLimit: 200_000,
    });
    const disabled = model({
      id: "old",
      providerID: "example",
      name: "Old model",
      enabled: false,
    });
    const api: SelectionApi = {
      model: {
        list: vi.fn<SelectionApi["model"]["list"]>(() =>
          Promise.resolve({ location: responseLocation, data: [fallback, claude, disabled] }),
        ),
        default: vi.fn<SelectionApi["model"]["default"]>(() =>
          Promise.resolve({ location: responseLocation, data: fallback }),
        ),
      },
      session: {
        switchModel: vi.fn<SelectionApi["session"]["switchModel"]>(() => Promise.resolve()),
      },
    };
    const root = withTestWorkspace((effects, dispose) => {
      const [selectedSession, setSelectedSession] = createSignal<SessionInfo>();
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          effects,
          api,
          data: data(
            api,
            vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve()),
          ),
          defaultLocation: location,
          selectedSession,
        }),
      };
    });

    await root.selection.sync();
    expect(api.model.list).toHaveBeenCalledWith({ location });
    expect(api.model.default).toHaveBeenCalledWith(
      { location },
      { signal: expect.any(AbortSignal) },
    );
    expect(root.selection.models().map((choice) => choice.label)).toEqual(["GPT", "Claude"]);
    expect(root.selection.models().map((choice) => choice.group)).toEqual(["openai", "anthropic"]);
    expect(root.selection.models().map((choice) => choice.label)).not.toContain("Old model");
    expect(root.selection.selectedModelID()).toBe(root.selection.models()[0]?.id);
    expect(root.selection.contextLimit()).toBe(128_000);

    root.setSelectedSession(
      session("session-1", {
        id: claude.id,
        providerID: claude.providerID,
        variant: "deep",
      }),
    );
    expect(root.selection.selectedModelID()).toBe(root.selection.models()[1]?.id);
    expect(root.selection.contextLimit()).toBe(200_000);
    expect(root.selection.variants().map((choice) => choice.id)).toEqual(["fast", "deep"]);
    expect(root.selection.selectedVariantID()).toBe("deep");
    root.dispose();
  });

  it("updates an initially empty picker when the SDK catalog refreshes", async () => {
    const available = model({ id: "gpt", providerID: "openai", name: "GPT" });
    const root = withTestWorkspace((effects, dispose) => {
      const [catalog, setCatalog] = createSignal<ModelInfo[]>([]);
      const selection = createModelSelection({
        effects,
        api: {
          model: { default: async () => ({ location: responseLocation, data: null }) },
          session: { switchModel: async () => undefined },
        },
        data: {
          session: { sync: async () => undefined },
          location: {
            model: { list: catalog, sync: async () => undefined, invalidate: () => undefined },
          },
        },
        defaultLocation: location,
        selectedSession: () =>
          session("session-1", { id: available.id, providerID: available.providerID }),
      });
      return { dispose, selection, setCatalog };
    });

    await root.selection.sync();
    expect(root.selection.models()).toEqual([]);
    root.setCatalog([available]);
    expect(root.selection.models().map((choice) => choice.label)).toEqual(["GPT"]);
    expect(root.selection.selectedModelID()).toBe(root.selection.models()[0]?.id);
    root.setCatalog([]);
    expect(root.selection.models()).toEqual([]);
    root.dispose();
  });

  it("switches only server-provided model and variant choices, then refreshes the session", async () => {
    const fallback = model({ id: "gpt", providerID: "openai", name: "GPT" });
    const claude = model({
      id: "claude",
      providerID: "anthropic",
      name: "Claude",
      variants: ["deep"],
    });
    const switchModel = vi.fn<SelectionApi["session"]["switchModel"]>(() => Promise.resolve());
    const syncSession = vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve());
    const api: SelectionApi = {
      model: {
        list: vi.fn<SelectionApi["model"]["list"]>(() =>
          Promise.resolve({ location: responseLocation, data: [fallback, claude] }),
        ),
        default: vi.fn<SelectionApi["model"]["default"]>(() =>
          Promise.resolve({ location: responseLocation, data: fallback }),
        ),
      },
      session: { switchModel },
    };
    const root = withTestWorkspace((effects, dispose) => {
      const [selectedSession, setSelectedSession] = createSignal(session("session-1"));
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          effects,
          api,
          data: data(api, syncSession),
          defaultLocation: location,
          selectedSession,
        }),
      };
    });

    await root.selection.sync();
    const claudeChoice = required(
      root.selection.models().find((choice) => choice.label === "Claude"),
      "Claude choice was not loaded",
    );
    await root.selection.selectModel(claudeChoice.id);
    expect(switchModel).toHaveBeenLastCalledWith(
      {
        sessionID: "session-1",
        model: { id: "claude", providerID: "anthropic" },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(syncSession).toHaveBeenLastCalledWith("session-1");

    root.setSelectedSession(session("session-1", { id: "claude", providerID: "anthropic" }));
    await root.selection.selectVariant("deep");
    expect(switchModel).toHaveBeenLastCalledWith(
      {
        sessionID: "session-1",
        model: { id: "claude", providerID: "anthropic", variant: "deep" },
      },
      { signal: expect.any(AbortSignal) },
    );

    await root.selection.selectVariant("invented");
    expect(switchModel).toHaveBeenCalledTimes(2);
    root.dispose();
  });

  it("cancels a switch without reporting interruption as a selection failure", async () => {
    const choice = model({ id: "gpt", providerID: "openai", name: "GPT" });
    const pending = deferred();
    const switchModel = vi.fn<SelectionApi["session"]["switchModel"]>(() => pending.promise);
    const syncSession = vi.fn<SelectionData["session"]["sync"]>(async () => undefined);
    const root = withTestWorkspace((effects) => ({
      close: () => Effect.runPromise(Scope.close(effects.scope, Exit.void)),
      selection: createModelSelection({
        effects,
        api: {
          model: { default: async () => ({ location: responseLocation, data: choice }) },
          session: { switchModel },
        },
        data: {
          location: {
            model: {
              list: () => [choice],
              sync: async () => undefined,
              invalidate: () => undefined,
            },
          },
          session: { sync: syncSession },
        },
        defaultLocation: location,
        selectedSession: () => session("session"),
      }),
    }));
    const choiceID = required(root.selection.models()[0], "Model was not loaded").id;
    const switching = root.selection.selectModel(choiceID).catch(() => undefined);
    const closing = root.close();
    expect(switchModel.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    pending.reject(new Error("cancelled native work"));
    await Promise.all([switching, closing]);
    expect(root.selection.error()).toBeUndefined();
    expect(root.selection.switching()).toBe(false);
    expect(syncSession).not.toHaveBeenCalled();
    await expect(root.selection.selectModel(choiceID)).rejects.toBeDefined();
    expect(switchModel).toHaveBeenCalledOnce();
  });

  it("keeps a failed switch scoped to the session where it happened", async () => {
    const fallback = model({ id: "gpt", providerID: "openai", name: "GPT" });
    const api: SelectionApi = {
      model: {
        list: vi.fn<SelectionApi["model"]["list"]>(() =>
          Promise.resolve({ location: responseLocation, data: [fallback] }),
        ),
        default: vi.fn<SelectionApi["model"]["default"]>(() =>
          Promise.resolve({ location: responseLocation, data: fallback }),
        ),
      },
      session: {
        switchModel: vi.fn<SelectionApi["session"]["switchModel"]>(() =>
          Promise.reject(new Error("offline")),
        ),
      },
    };
    const root = withTestWorkspace((effects, dispose) => {
      const [selectedSession, setSelectedSession] = createSignal(session("session-1"));
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          effects,
          api,
          data: data(
            api,
            vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve()),
          ),
          defaultLocation: location,
          selectedSession,
        }),
      };
    });

    await root.selection.sync();
    const firstModel = required(root.selection.models()[0], "Default model was not loaded");
    await root.selection.selectModel(firstModel.id);
    expect(root.selection.error()).toBe("The model could not be changed. Try again.");
    root.setSelectedSession(session("session-2"));
    expect(root.selection.error()).toBeUndefined();
    root.dispose();
  });
});
