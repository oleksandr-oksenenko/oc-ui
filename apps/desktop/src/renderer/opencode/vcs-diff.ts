import { useAtomValue } from "@effect/atom-solid";
import type { FileDiffInfo, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { locationKey } from "@opencode-ai/client/solid";
import { Cause, Effect, Fiber, FiberMap, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";

import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { OpenCodeEventSource } from "./event-source";

export type VcsDiffMode = "working" | "branch";
type VcsDiffStatus = "idle" | "loading" | "refreshing" | "ready" | "failed";

type VcsDiffSnapshot = {
  readonly files: readonly FileDiffInfo[];
  readonly status: VcsDiffStatus;
  readonly stale: boolean;
  readonly error?: string;
};

export type VcsDiffStore = {
  readonly state: (location: LocationRef, mode: VcsDiffMode) => VcsDiffSnapshot;
  readonly sync: (location: LocationRef, mode: VcsDiffMode) => Effect.Effect<void>;
  readonly refresh: (location: LocationRef, mode: VcsDiffMode) => Effect.Effect<void>;
  readonly poll: (location: LocationRef, mode: VcsDiffMode) => Effect.Effect<never>;
};

type VcsDiffStoreInput = {
  readonly diff: OpenCodeClient["vcs"]["diff"];
  readonly events: Pick<OpenCodeEventSource, "on">;
  readonly effects: WorkspaceOwner;
};

const EMPTY: VcsDiffSnapshot = { files: [], status: "idle", stale: false };
const keyOf = (location: LocationRef, mode: VcsDiffMode): string =>
  `${locationKey(location)}:${mode}`;

export function createVcsDiffStore(input: VcsDiffStoreInput): VcsDiffStore {
  const { effects } = input;
  const cache = Atom.make<Readonly<Record<string, VcsDiffSnapshot>>>({});
  effects.mount(cache);
  const snapshots = useAtomValue(() => cache);
  const requests = effects.runSync(FiberMap.make<string, void, never>());
  const write = (key: string, snapshot: VcsDiffSnapshot): void =>
    effects.registry.update(cache, (current) => ({ ...current, [key]: snapshot }));

  const invalidateEntry = (key: string): void => {
    Option.getOrUndefined(FiberMap.getUnsafe(requests, key))?.interruptUnsafe();
    const current = effects.registry.get(cache)[key];
    if (current) {
      write(key, {
        files: current.files,
        status: current.files.length > 0 ? "ready" : "idle",
        stale: true,
      });
    }
  };

  const invalidate = (location?: LocationRef): void => {
    const keys = location
      ? [keyOf(location, "working"), keyOf(location, "branch")]
      : Object.keys(effects.registry.get(cache));
    keys.forEach(invalidateEntry);
  };

  const load = Effect.fn("VcsDiffStore.load")(function* (
    location: LocationRef,
    mode: VcsDiffMode,
    background: boolean,
  ) {
    const key = keyOf(location, mode);
    const before = effects.registry.get(cache)[key] ?? EMPTY;
    write(key, {
      ...before,
      status: background ? "refreshing" : "loading",
      error: background ? before.error : undefined,
    });
    yield* effects
      .request((signal) =>
        input.diff(
          {
            location: location.workspaceID
              ? { directory: location.directory, workspace: location.workspaceID }
              : { directory: location.directory },
            mode,
            // Omitted context requests a full-context patch, validated by the renderer.
          },
          { signal },
        ),
      )
      .pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            const previous = new Map(before.files.map((file) => [file.file, file]));
            const files = response.data.map((file) => {
              const old = previous.get(file.file);
              return old &&
                old.patch === file.patch &&
                old.status === file.status &&
                old.additions === file.additions &&
                old.deletions === file.deletions
                ? old
                : file;
            });
            write(key, {
              files:
                files.length === before.files.length &&
                files.every((file, i) => file === before.files[i])
                  ? before.files
                  : files,
              status: "ready",
              stale: false,
            });
          }),
        ),
        Effect.catchTag("WorkspaceRequestError", ({ cause }) =>
          Effect.sync(() => {
            if (cause instanceof DOMException && cause.name === "AbortError") return;
            write(key, {
              files: before.files,
              status: "failed",
              stale: before.files.length > 0 || before.stale,
              error:
                cause instanceof Error && cause.message
                  ? cause.message
                  : "The diff could not be loaded. Check the connection and try again.",
            });
          }),
        ),
      );
  });

  const start = Effect.fn("VcsDiffStore.start")(function* (
    location: LocationRef,
    mode: VcsDiffMode,
    policy: "sync" | "refresh" | "revalidate",
  ) {
    const key = keyOf(location, mode);
    if (policy === "refresh") invalidateEntry(key);
    const current = effects.registry.get(cache)[key] ?? EMPTY;
    let request = Option.getOrUndefined(FiberMap.getUnsafe(requests, key));
    if (!request || (current.status !== "loading" && current.status !== "refreshing")) {
      if (policy === "sync" && current.status === "ready" && !current.stale) return;
      request = effects.runFork(
        load(location, mode, policy === "revalidate" && current.status !== "idle"),
      );
      FiberMap.setUnsafe(requests, key, request);
    }
    yield* Fiber.join(request).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
    );
  });

  // HACK: V2 beta-19271 only publishes external filesystem changes for branch
  // metadata. Remove polling when upstream supplies working-tree change events.
  // Related report: https://github.com/anomalyco/opencode/issues/48451 (dev, not V2).
  const poll = Effect.fn("VcsDiffStore.poll")(function* (location: LocationRef, mode: VcsDiffMode) {
    while (true) {
      yield* start(location, mode, "revalidate");
      const failed = effects.registry.get(cache)[keyOf(location, mode)]?.status === "failed";
      yield* Effect.sleep(failed ? "10 seconds" : "2 seconds");
    }
  });

  effects.runSync(
    Effect.acquireRelease(
      Effect.sync(() => [
        input.events.on("filesystem.changed", (event) => invalidate(event.location)),
        input.events.on("vcs.branch.updated", (event) => invalidate(event.location)),
        input.events.on("server.connected", () => invalidate()),
      ]),
      (stops) => Effect.sync(() => stops.forEach((stop) => stop())),
    ),
  );

  return {
    state: (location, mode) => snapshots()[keyOf(location, mode)] ?? EMPTY,
    sync: (location, mode) => start(location, mode, "sync"),
    refresh: (location, mode) => start(location, mode, "refresh"),
    poll,
  };
}
