import type { ModelInfo, SessionInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createModelSelection } from "./model-selection.ts";

const location = { directory: "/workspace" } as const;
const responseLocation = {
  directory: "/workspace",
  project: { id: "project", directory: "/workspace", canonical: "/workspace" },
} as const;
type SelectionInput = Parameters<typeof createModelSelection>[0];
type SelectionApi = SelectionInput["api"];
type SelectionData = SelectionInput["data"];

function model(input: {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly variants?: readonly string[];
  readonly enabled?: boolean;
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
    limit: { context: 1, output: 1 },
  };
}

function session(id: string, selected?: SessionInfo["model"]): SessionInfo {
  return {
    id,
    projectID: "project",
    model: selected,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location,
  };
}

function data(sync: SelectionData["session"]["sync"]): SelectionData {
  return { session: { sync } };
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
    const root = createRoot((dispose) => ({
      dispose,
      selection: createModelSelection({
        api,
        data: data(vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve())),
        defaultLocation: location,
        selectedSession: () => undefined,
      }),
    }));

    await expect(root.selection.sync()).rejects.toThrow("offline");
    expect(root.selection.state()).toBe("failed");
    expect(root.selection.models()).toEqual([]);
    expect(root.selection.error()).toBe(
      "Models could not be loaded. Check the connection and try again.",
    );
    root.dispose();
  });

  it("loads the location catalog and follows session-over-default selection", async () => {
    const fallback = model({ id: "gpt", providerID: "openai", name: "GPT" });
    const claude = model({
      id: "claude",
      providerID: "anthropic",
      name: "Claude",
      variants: ["fast", "deep"],
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
    const root = createRoot((dispose) => {
      const [selectedSession, setSelectedSession] = createSignal<SessionInfo>();
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          api,
          data: data(vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve())),
          defaultLocation: location,
          selectedSession,
        }),
      };
    });

    await root.selection.sync();
    expect(api.model.list).toHaveBeenCalledWith({ location });
    expect(api.model.default).toHaveBeenCalledWith({ location });
    expect(root.selection.models().map((choice) => choice.label)).toEqual(["GPT", "Claude"]);
    expect(root.selection.models().map((choice) => choice.group)).toEqual(["openai", "anthropic"]);
    expect(root.selection.models().map((choice) => choice.label)).not.toContain("Old model");
    expect(root.selection.selectedModelID()).toBe(root.selection.models()[0]?.id);

    root.setSelectedSession(
      session("session-1", {
        id: claude.id,
        providerID: claude.providerID,
        variant: "deep",
      }),
    );
    expect(root.selection.selectedModelID()).toBe(root.selection.models()[1]?.id);
    expect(root.selection.variants().map((choice) => choice.id)).toEqual(["fast", "deep"]);
    expect(root.selection.selectedVariantID()).toBe("deep");
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
    const root = createRoot((dispose) => {
      const [selectedSession, setSelectedSession] = createSignal(session("session-1"));
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          api,
          data: data(syncSession),
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
    expect(switchModel).toHaveBeenLastCalledWith({
      sessionID: "session-1",
      model: { id: "claude", providerID: "anthropic" },
    });
    expect(syncSession).toHaveBeenLastCalledWith("session-1");

    root.setSelectedSession(session("session-1", { id: "claude", providerID: "anthropic" }));
    await root.selection.selectVariant("deep");
    expect(switchModel).toHaveBeenLastCalledWith({
      sessionID: "session-1",
      model: { id: "claude", providerID: "anthropic", variant: "deep" },
    });

    await root.selection.selectVariant("invented");
    expect(switchModel).toHaveBeenCalledTimes(2);
    root.dispose();
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
    const root = createRoot((dispose) => {
      const [selectedSession, setSelectedSession] = createSignal(session("session-1"));
      return {
        dispose,
        setSelectedSession,
        selection: createModelSelection({
          api,
          data: data(vi.fn<SelectionData["session"]["sync"]>(() => Promise.resolve())),
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
