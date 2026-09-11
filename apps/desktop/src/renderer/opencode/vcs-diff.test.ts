import type {
  FileDiffInfo,
  LocationRef,
  OpenCodeClient,
  OpenCodeEvent,
  VcsDiffOutput,
} from "@opencode-ai/client";
import { Effect, Exit, Fiber, Scope } from "effect";
import { withTestWorkspace } from "../test/workspace.ts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "./event-source.ts";
import { createVcsDiffStore } from "./vcs-diff.ts";

type DiffRequest = OpenCodeClient["vcs"]["diff"];

const location = (directory: string, workspaceID?: string): LocationRef => ({
  directory,
  workspaceID,
});

const file = (name: string): FileDiffInfo => ({
  file: name,
  patch: `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`,
  additions: 1,
  deletions: 1,
  status: "modified",
});

const response = (ref: LocationRef, files: FileDiffInfo[]): VcsDiffOutput => ({
  location: {
    directory: ref.directory,
    workspaceID: ref.workspaceID,
    project: { id: "project", directory: ref.directory, canonical: ref.directory },
  },
  data: files,
});

const setup = (diff: DiffRequest) => {
  const events = createOpenCodeEventSource();
  return withTestWorkspace((effects, dispose) => {
    const store = createVcsDiffStore({ diff, events, effects });
    return {
      dispose,
      events,
      effects,
      store: {
        state: store.state,
        sync: (ref: LocationRef, mode: Parameters<typeof store.sync>[1]) =>
          effects.runPromise(store.sync(ref, mode)),
        refresh: (ref: LocationRef, mode: Parameters<typeof store.refresh>[1]) =>
          effects.runPromise(store.refresh(ref, mode)),
        poll: store.poll,
      },
    };
  });
};

describe("VCS diff store", () => {
  it("polls sequentially, preserves unchanged rows, backs off failures, and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const ref = location("/workspace", "worktree-1");
      let resolve!: (value: VcsDiffOutput) => void;
      const diff = vi
        .fn<DiffRequest>()
        .mockResolvedValueOnce(response(ref, [file("a.ts")]))
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(response(ref, [file("a.ts"), file("b.ts")]));
      const { store, effects } = setup(diff);
      const polling = effects.runFork(store.poll(ref, "working"));
      await vi.advanceTimersByTimeAsync(0);
      const original = store.state(ref, "working").files;
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(diff).toHaveBeenCalledTimes(2);
      resolve(response(ref, [file("a.ts")]));
      await vi.advanceTimersByTimeAsync(0);
      expect(store.state(ref, "working").files).toBe(original);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(store.state(ref, "working").status).toBe("failed");
      expect(store.state(ref, "working").files).toBe(original);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(diff).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.state(ref, "working").files[0]).toBe(original[0]);
      expect(store.state(ref, "working").files).toHaveLength(2);
      await effects.runPromise(Fiber.interrupt(polling));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(diff).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it("maps workspaceID to the generated API request and caches by mode", async () => {
    const ref = location("/workspace", "worktree-1");
    const diff = vi.fn<DiffRequest>(() => Promise.resolve(response(ref, [file("src/a.ts")])));
    const { dispose, store } = setup(diff);

    await Promise.all([store.sync(ref, "working"), store.sync(ref, "working")]);
    expect(diff).toHaveBeenCalledOnce();
    expect(diff.mock.calls[0]?.[0]).toEqual({
      location: { directory: "/workspace", workspace: "worktree-1" },
      mode: "working",
    });
    expect(diff.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(store.state(ref, "working")).toMatchObject({
      status: "ready",
      stale: false,
      files: [{ file: "src/a.ts" }],
    });

    await store.sync(ref, "branch");
    expect(diff).toHaveBeenCalledTimes(2);
    expect(diff.mock.calls[1]?.[0].mode).toBe("branch");
    dispose();
  });

  it("refresh aborts and replaces only the same cache entry", async () => {
    const ref = location("/workspace");
    let firstSignal: AbortSignal | undefined;
    const diff = vi
      .fn<DiffRequest>()
      .mockImplementationOnce((_input, options) => {
        if (!options?.signal) return Promise.reject(new Error("Missing abort signal"));
        firstSignal = options.signal;
        return new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      })
      .mockResolvedValueOnce(response(ref, [file("latest.ts")]));
    const { dispose, store } = setup(diff);

    void store.sync(ref, "working");
    await store.refresh(ref, "working");
    expect(firstSignal?.aborted).toBe(true);
    expect(store.state(ref, "working").files[0]?.file).toBe("latest.ts");
    expect(store.state(ref, "working").status).toBe("ready");
    dispose();
  });

  it("invalidates matching locations and conservatively invalidates all unscoped events", async () => {
    const first = location("/first");
    const second = location("/second");
    const diff = vi.fn<DiffRequest>((input) => {
      const ref = input.location?.directory === "/first" ? first : second;
      return Promise.resolve(response(ref, [file(`${ref.directory}.ts`)]));
    });
    const { dispose, events, store } = setup(diff);

    await Promise.all([store.sync(first, "working"), store.sync(second, "working")]);
    events.emit({
      id: "file-change",
      created: 1,
      type: "filesystem.changed",
      location: first,
      data: { file: "a.ts", event: "change" },
    } satisfies OpenCodeEvent);
    expect(store.state(first, "working").stale).toBe(true);
    expect(store.state(second, "working").stale).toBe(false);

    events.emit({
      id: "branch-change",
      created: 2,
      type: "vcs.branch.updated",
      data: { branch: "feature" },
    } satisfies OpenCodeEvent);
    expect(store.state(second, "working").stale).toBe(true);

    await Promise.all([store.sync(first, "working"), store.sync(second, "working")]);
    expect(store.state(first, "working").stale).toBe(false);
    expect(store.state(second, "working").stale).toBe(false);
    events.emit({
      id: "connected",
      type: "server.connected",
      data: {},
    } satisfies OpenCodeEvent);
    expect(store.state(first, "working").stale).toBe(true);
    expect(store.state(second, "working").stale).toBe(true);
    dispose();
  });

  it("keeps cached files when a refresh fails", async () => {
    const ref = location("/workspace");
    const diff = vi
      .fn<DiffRequest>()
      .mockResolvedValueOnce(response(ref, [file("cached.ts")]))
      .mockRejectedValueOnce(new Error("server unavailable"));
    const { dispose, store } = setup(diff);

    await store.sync(ref, "working");
    await store.refresh(ref, "working");
    expect(store.state(ref, "working")).toMatchObject({
      status: "failed",
      stale: true,
      error: "server unavailable",
      files: [{ file: "cached.ts" }],
    });
    dispose();
  });

  it("discards late results from an invalidated request while a replacement loads", async () => {
    const ref = location("/workspace");
    let resolveOld!: (value: VcsDiffOutput) => void;
    let signal: AbortSignal | undefined;
    const diff = vi
      .fn<DiffRequest>()
      .mockImplementationOnce((_input, options) => {
        signal = options?.signal;
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      })
      .mockResolvedValueOnce(response(ref, [file("latest.ts")]));
    const { store, events } = setup(diff);
    const obsolete = store.sync(ref, "working");
    events.emit({
      id: "change",
      created: 1,
      type: "filesystem.changed",
      location: ref,
      data: { file: "old.ts", event: "change" },
    } satisfies OpenCodeEvent);
    expect(signal?.aborted).toBe(true);
    await store.sync(ref, "working");
    resolveOld(response(ref, [file("obsolete.ts")]));
    await obsolete;
    expect(store.state(ref, "working").files[0]?.file).toBe("latest.ts");
  });

  it("retains a pending poll read after its subscriber leaves and awaits it at workspace shutdown", async () => {
    const ref = location("/workspace");
    let resolve!: (value: VcsDiffOutput) => void;
    let signal: AbortSignal | undefined;
    const diff = vi.fn<DiffRequest>((_input, options) => {
      signal = options?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const { store, effects } = setup(diff);
    const polling = effects.runFork(store.poll(ref, "working"));
    await effects.runPromise(Fiber.interrupt(polling));
    expect(signal?.aborted).toBe(false);
    let closed = false;
    const closing = Effect.runPromise(Scope.close(effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(false);
    resolve(response(ref, [file("late.ts")]));
    await closing;
    expect(store.state(ref, "working").status).toBe("loading");
  });
});
