import type { FileDiffInfo, SessionInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { sessionFixture } from "../../../../test/session-fixture.ts";
import { createReviewDraftStore, type ReviewDraftKey } from "../../../../domain/review-drafts.ts";
import {
  createWorkspaceChanges,
  type WorkspaceChangesInput,
  type WorkspaceChangesRuntime,
} from "./createWorkspaceChanges.ts";

const location = { directory: "/workspace" } as const;

const session = (id = "session-1"): SessionInfo =>
  sessionFixture({
    id,
    location,
  });

const file = (name: string): FileDiffInfo => ({
  file: name,
  patch: `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`,
  additions: 1,
  deletions: 1,
  status: "modified",
});

const reviewSelection = {
  start: 1,
  side: "additions",
  end: 1,
  endSide: "additions",
} as const;

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
    const reviewDrafts = createReviewDraftStore();
    const requestRemoveComment = vi.fn<WorkspaceChangesInput["requestRemoveComment"]>();
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
      reviewDrafts,
      requestRemoveComment,
    });

    const updateSelectedSession = (next: SessionInfo | undefined): void => {
      setSelectedSession(next);
    };

    return {
      dispose,
      changes,
      setSelectedSession: updateSelectedSession,
      setBootstrapped,
      setConnected,
      setPanelOpen,
      setSnapshot,
      setBranch,
      syncLocation,
      syncDiff,
      refreshDiff,
      reviewDrafts,
      requestRemoveComment,
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

    expect(root.changes.view()).toMatchObject({
      files: [
        {
          file: "src/example.ts",
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
    root.changes.view().onRetry?.();
    expect(root.refreshDiff).toHaveBeenCalledWith(location, "working");

    root.setSelectedSession(undefined);
    expect(root.changes.view()).toMatchObject({
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

    expect(root.changes.view().comparisonOptions).toEqual([
      { value: "working", label: "Working changes" },
      { value: "branch", label: "Changes vs main" },
    ]);
    root.changes.view().onComparisonChange?.("branch");
    expect(root.changes.view().comparison).toBe("branch");
    expect(root.changes.view().emptyMessage).toBe("No changes against main");
    expect(root.changes.view().emptyDescription).toBe(
      "The working copy matches its merge base with main.",
    );

    root.setBranch(undefined);
    await settle();
    expect(root.changes.view().comparison).toBe("working");

    root.dispose();
  });

  it("removes empty comments immediately but delegates non-empty removal", () => {
    const root = setup({ selected: session() });
    const key: ReviewDraftKey = { sessionID: "session-1", comparison: "working" };
    const emptyID = root.reviewDrafts.begin(key, "src/example.ts", reviewSelection, "new\n");
    const emptyOpener = document.createElement("button");

    root.changes.view().review?.onRemoveComment?.(emptyID, emptyOpener);

    expect(root.requestRemoveComment).not.toHaveBeenCalled();
    expect(root.reviewDrafts.get(key).comments).toHaveLength(0);

    const nonEmptyID = root.reviewDrafts.begin(key, "src/example.ts", reviewSelection, "new\n");
    root.reviewDrafts.updateBody(key, nonEmptyID, "Please check this line");
    const nonEmptyOpener = document.createElement("button");

    root.changes.view().review?.onRemoveComment?.(nonEmptyID, nonEmptyOpener);

    expect(root.requestRemoveComment).toHaveBeenCalledWith(key, nonEmptyID, nonEmptyOpener);
    expect(root.reviewDrafts.get(key).comments).toHaveLength(1);

    root.dispose();
  });

  it("finishes a non-empty editor and drops an empty one", () => {
    const root = setup({ selected: session() });
    const key: ReviewDraftKey = { sessionID: "session-1", comparison: "working" };
    const savedID = root.reviewDrafts.begin(key, "src/example.ts", reviewSelection, "new\n");
    root.reviewDrafts.updateBody(key, savedID, "Fix this");

    root.changes.view().review?.onFinishComment?.(savedID);
    expect(root.reviewDrafts.get(key).comments).toMatchObject([{ id: savedID, body: "Fix this" }]);
    expect(root.reviewDrafts.get(key).editingCommentID).toBeUndefined();

    const emptyID = root.reviewDrafts.begin(key, "src/example.ts", reviewSelection, "new\n");
    root.changes.view().review?.onFinishComment?.(emptyID);
    expect(root.reviewDrafts.get(key).comments.map((comment) => comment.id)).toEqual([savedID]);

    root.dispose();
  });

  it("keeps projected files stable across reactive review and status updates", () => {
    const files = [file("src/example.ts")];
    const root = setup({
      selected: session(),
      snapshot: { files, status: "ready", stale: false },
    });
    const projected = root.changes.view().files;
    const projectedFile = projected[0];
    const key = root.changes.reviewKey();
    expect(key).toEqual({ sessionID: "session-1", comparison: "working" });

    const commentID = root.reviewDrafts.begin(key!, "src/example.ts", reviewSelection, "new\n");
    expect(root.changes.view().files).toBe(projected);
    root.reviewDrafts.updateBody(key!, commentID, "Please check this line");
    expect(root.changes.view().files).toBe(projected);
    expect(root.changes.view().files[0]).toBe(projectedFile);

    root.setSnapshot({ files, status: "loading", stale: true });
    expect(root.changes.view().files).toBe(projected);
    expect(root.changes.view().files[0]).toBe(projectedFile);

    root.setSnapshot({ files: [...files], status: "ready", stale: false });
    expect(root.changes.view().files[0]).toEqual(projectedFile);
    expect(root.changes.view().files[0]).not.toBe(projectedFile);

    root.dispose();
  });
});
