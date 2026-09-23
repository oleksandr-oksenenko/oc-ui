import type { FileDiffInfo, SessionInfo } from "@opencode/client";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createReviewDraftStore } from "../../../../domain/review-drafts.ts";
import { mount } from "../../../../test/mount.ts";
import { stubResizeObserver } from "../../../../test/resize-observer.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { ChangesRegion } from "./ChangesRegion.tsx";
import { prepareDiffRender } from "./ContextPanel/DiffView/diff-render-data.ts";
import { createWorkspaceChanges, type WorkspaceChangesRuntime } from "./createWorkspaceChanges.ts";

vi.mock("./ContextPanel/DiffView/diff-render-data.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ContextPanel/DiffView/diff-render-data.ts")>();
  return {
    ...actual,
    prepareDiffRender: vi.fn<typeof actual.prepareDiffRender>(actual.prepareDiffRender),
  };
});

const location = { directory: "/workspace" } as const;
const reviewSelection = { start: 1, side: "additions", end: 1, endSide: "additions" } as const;

type Snapshot = {
  readonly files: readonly FileDiffInfo[];
  readonly status: "idle" | "loading" | "refreshing" | "ready" | "failed";
  readonly stale: boolean;
  readonly error?: string;
};

type Branch = { readonly current?: string; readonly default?: string };

const file = (name: string, patch = "@@ -1 +1 @@\n-old\n+new\n"): FileDiffInfo => ({
  file: name,
  patch,
  additions: 1,
  deletions: 1,
  status: "modified",
});

const setup = (options?: { readonly branch?: Branch }) =>
  withTestWorkspace((effects) => {
    const [selectedSession] = createSignal<SessionInfo | undefined>(
      sessionFixture({ id: "session-1", location }),
    );
    const [bootstrapped] = createSignal(true);
    const [connected] = createSignal(true);
    const [panelOpen] = createSignal(true);
    const [snapshot, setSnapshot] = createSignal<Snapshot>({
      files: [file("src/example.ts")],
      status: "ready",
      stale: false,
    });
    const reviewDrafts = createReviewDraftStore(effects);
    type Vcs = WorkspaceChangesRuntime["data"]["location"]["vcs"];
    type Diffs = WorkspaceChangesRuntime["diffs"];
    const stopPolling = vi.fn<() => void>();
    const runtime: WorkspaceChangesRuntime = {
      data: {
        location: {
          vcs: {
            info: vi.fn<Vcs["info"]>(() =>
              options?.branch === undefined ? undefined : { branch: options.branch },
            ),
            sync: vi.fn<Vcs["sync"]>(() => Promise.resolve()),
          },
        },
      },
      diffs: {
        state: vi.fn<Diffs["state"]>(() => snapshot()),
        sync: vi.fn<Diffs["sync"]>(() => Effect.void),
        refresh: vi.fn<Diffs["refresh"]>(() => Effect.void),
        poll: vi.fn<Diffs["poll"]>(() =>
          Effect.never.pipe(Effect.ensuring(Effect.sync(stopPolling))),
        ),
      },
    };
    const changes = createWorkspaceChanges({
      runtime,
      effects,
      selectedSession,
      bootstrapped,
      connected,
      panelOpen,
      reviewDrafts,
      requestRemoveComment: () => undefined,
    });
    const { host, dispose } = mount(() => (
      <ChangesRegion
        idBase="changes-region-test"
        files={changes.files()}
        presentation={changes.presentation()}
        review={changes.review()}
        showTabs={false}
        onClose={() => undefined}
      />
    ));
    return { changes, reviewDrafts, setSnapshot, host, dispose };
  });

/** Let any queued Solid effects flush after a snapshot publication. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  stubResizeObserver();
  // Clear per test so the initial assertion proves this mount parsed.
  vi.mocked(prepareDiffRender).mockClear();
});

describe("ChangesRegion", () => {
  it("does not reparse patches when only a review body changes", async () => {
    const root = setup();
    const prepare = vi.mocked(prepareDiffRender);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    const files = root.changes.files();
    prepare.mockClear();

    const key = root.changes.reviewKey()!;
    const commentID = root.reviewDrafts.begin(key, "src/example.ts", reviewSelection, "new\n");
    // The editor reaching the DOM proves the review prop reached the view.
    await vi.waitFor(() => expect(root.host.querySelector(".diff-review-editor")).not.toBeNull());
    const editor = root.host.querySelector(".diff-review-editor");

    root.reviewDrafts.updateBody(key, commentID, "first");
    root.reviewDrafts.updateBody(key, commentID, "second");
    await settle();

    expect(prepare).not.toHaveBeenCalled();
    // Body-only updates must not replace the editor node. Caret/focus behavior
    // is covered by the browser review flow, not by node identity alone.
    expect(root.host.querySelector(".diff-review-editor")).toBe(editor);
    expect(root.changes.files()).toBe(files);
    expect(root.reviewDrafts.get(key).comments[0]?.body).toBe("second");

    root.dispose();
  });

  it("does not reparse patches when presentation changes with the same files reference", async () => {
    const root = setup();
    const prepare = vi.mocked(prepareDiffRender);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    const files = root.changes.files();
    prepare.mockClear();

    // A new snapshot object with unchanged fields must not reach the parser.
    root.setSnapshot({ files, status: "ready", stale: false });
    await settle();
    // Background refresh round-trip, observed through the rendered state.
    root.setSnapshot({ files, status: "loading", stale: true });
    await vi.waitFor(() => expect(root.host.textContent).toContain("Refreshing diff"));
    root.setSnapshot({ files, status: "ready", stale: false });
    await vi.waitFor(() => expect(root.host.textContent).not.toContain("Refreshing diff"));
    // Cached-changes notice appears and clears with the same files.
    root.setSnapshot({ files, status: "ready", stale: true });
    await vi.waitFor(() => expect(root.host.textContent).toContain("Showing cached changes"));
    root.setSnapshot({ files, status: "ready", stale: false });
    await vi.waitFor(() => expect(root.host.textContent).not.toContain("Showing cached changes"));
    // Error appears and clears with cached files.
    root.setSnapshot({ files, status: "failed", stale: true, error: "offline" });
    await vi.waitFor(() => expect(root.host.textContent).toContain("offline"));
    root.setSnapshot({ files, status: "ready", stale: false });
    await vi.waitFor(() => expect(root.host.textContent).not.toContain("offline"));

    expect(prepare).not.toHaveBeenCalled();
    expect(root.changes.files()).toBe(files);

    root.dispose();
  });

  it("does not reparse patches when the comparison changes with the same files", async () => {
    const root = setup({ branch: { current: "feature", default: "main" } });
    const prepare = vi.mocked(prepareDiffRender);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    const files = root.changes.files();
    prepare.mockClear();

    expect(root.changes.presentation().comparisonOptions).toHaveLength(2);
    root.changes.presentation().onComparisonChange?.("branch");
    await settle();

    expect(root.changes.presentation().comparison).toBe("branch");
    expect(root.changes.files()).toBe(files);
    expect(prepare).not.toHaveBeenCalled();

    root.dispose();
  });

  it("reparses patches when the files array reference changes, even with equal content", async () => {
    const root = setup();
    const prepare = vi.mocked(prepareDiffRender);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    prepare.mockClear();

    // Same file objects in a new array: reference change, so parse again.
    root.setSnapshot({
      files: [...root.changes.files()],
      status: "ready",
      stale: false,
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());

    root.dispose();
  });

  it("reparses patches when a patch changes in a replacement array", async () => {
    const root = setup();
    const prepare = vi.mocked(prepareDiffRender);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    prepare.mockClear();

    root.setSnapshot({
      files: [file("src/example.ts", "@@ -1 +1 @@\n-old\n+changed\n")],
      status: "ready",
      stale: false,
    });

    await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
    root.dispose();
  });
});
