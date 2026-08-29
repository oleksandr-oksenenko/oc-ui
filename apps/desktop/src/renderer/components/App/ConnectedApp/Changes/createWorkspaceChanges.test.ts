import type { FileDiffInfo, SessionInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createWorkspaceChanges, type WorkspaceChangesRuntime } from "./createWorkspaceChanges.ts";

const location = { directory: "/workspace" } as const;

const session = (id = "session-1"): SessionInfo => ({
  id,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location,
});

const file = (name: string): FileDiffInfo => ({
  file: name,
  patch: `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`,
  additions: 1,
  deletions: 1,
  status: "modified",
});

type Snapshot = {
  readonly files: readonly FileDiffInfo[];
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly stale: boolean;
  readonly error?: string;
};

const setup = (options?: {
  readonly selected?: SessionInfo;
  readonly snapshot?: Snapshot;
  readonly branch?: { readonly current?: string; readonly default?: string };
}) =>
  createRoot((dispose) => {
    const [selectedSession, setSelectedSession] = createSignal(options?.selected);
    const [bootstrapped, setBootstrapped] = createSignal(false);
    const [connected, setConnected] = createSignal(false);
    const [panelOpen, setPanelOpen] = createSignal(false);
    const [snapshot, setSnapshot] = createSignal<Snapshot>(
      options?.snapshot ?? { files: [], status: "idle", stale: false },
    );
    const [branch, setBranch] = createSignal(options?.branch);
    type Vcs = WorkspaceChangesRuntime["data"]["location"]["vcs"];
    type Diffs = WorkspaceChangesRuntime["diffs"];
    const syncLocation = vi.fn<Vcs["sync"]>(() => Promise.resolve());
    const syncDiff = vi.fn<Diffs["sync"]>(() => Promise.resolve());
    const refreshDiff = vi.fn<Diffs["refresh"]>(() => Promise.resolve());
    const info = vi.fn<Vcs["info"]>(() => {
      const current = branch();
      return current === undefined ? undefined : { branch: current };
    });
    const runtime: WorkspaceChangesRuntime = {
      data: {
        location: {
          vcs: {
            info,
            sync: syncLocation,
          },
        },
      },
      diffs: {
        state: vi.fn<Diffs["state"]>(() => snapshot()),
        sync: syncDiff,
        refresh: refreshDiff,
      },
    };
    const changes = createWorkspaceChanges({
      runtime,
      selectedSession,
      bootstrapped,
      connected,
      panelOpen,
    });

    return {
      dispose,
      changes,
      setSelectedSession,
      setBootstrapped,
      setConnected,
      setPanelOpen,
      setSnapshot,
      setBranch,
      syncLocation,
      syncDiff,
      refreshDiff,
    };
  });

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createWorkspaceChanges", () => {
  it("synchronizes only when a selected location is fully ready and visible", async () => {
    const root = setup();

    root.setSelectedSession(session());
    root.setBootstrapped(true);
    root.setConnected(true);
    await settle();
    expect(root.syncLocation).not.toHaveBeenCalled();
    expect(root.syncDiff).not.toHaveBeenCalled();

    root.setPanelOpen(true);
    await settle();
    expect(root.syncLocation).toHaveBeenCalledWith(location);
    expect(root.syncDiff).toHaveBeenCalledWith(location, "working");

    root.dispose();
  });

  it("maps a snapshot, preserves exact empty messages, and retries the selected mode", () => {
    const root = setup({
      selected: session(),
      snapshot: {
        files: [file("src/example.ts")],
        status: "failed",
        stale: true,
        error: "server unavailable",
      },
    });

    expect(root.changes()).toMatchObject({
      files: [
        {
          path: "src/example.ts",
          patch: expect.any(String),
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
      loading: false,
      error: "server unavailable",
      stale: true,
      emptyMessage: "No working tree changes",
      emptyDescription: "The working copy matches HEAD.",
      comparison: "working",
    });
    root.changes().onRetry?.();
    expect(root.refreshDiff).toHaveBeenCalledWith(location, "working");

    root.setSelectedSession(undefined);
    expect(root.changes()).toMatchObject({
      files: [],
      loading: false,
      emptyMessage: "Select a session to view changes",
      emptyDescription: "The Diff panel follows the selected session's workspace location.",
      comparison: "working",
    });

    root.dispose();
  });

  it("offers branch comparison and resets it when the branch option disappears", async () => {
    const root = setup({
      selected: session(),
      snapshot: { files: [], status: "ready", stale: false },
      branch: { current: "feature", default: "main" },
    });

    expect(root.changes().comparisonOptions).toEqual([
      { value: "working", label: "Working changes" },
      { value: "branch", label: "Changes vs main" },
    ]);
    root.changes().onComparisonChange?.("branch");
    expect(root.changes().comparison).toBe("branch");
    expect(root.changes().emptyMessage).toBe("No changes against main");
    expect(root.changes().emptyDescription).toBe(
      "The working copy matches its merge base with main.",
    );

    root.setBranch(undefined);
    await settle();
    expect(root.changes().comparison).toBe("working");

    root.dispose();
  });
});
