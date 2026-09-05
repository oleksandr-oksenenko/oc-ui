import { useAtomValue } from "@effect/atom-solid";
import type { FileDiffInfo, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { locationKey } from "@opencode-ai/client/solid";
import { Cause, Effect, Fiber, FiberMap, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";

import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { OpenCodeEventSource } from "./event-source";

export type VcsDiffMode = "working" | "branch";
type VcsDiffStatus = "idle" | "loading" | "ready" | "failed";

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

  const load = Effect.fn("VcsDiffStore.load")(function* (location: LocationRef, mode: VcsDiffMode) {
    const key = keyOf(location, mode);
    const before = effects.registry.get(cache)[key] ?? EMPTY;
    write(key, { ...before, status: "loading", error: undefined });
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
          Effect.sync(() => write(key, { files: response.data, status: "ready", stale: false })),
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
    force: boolean,
  ) {
    const key = keyOf(location, mode);
    if (force) invalidateEntry(key);
    const current = effects.registry.get(cache)[key] ?? EMPTY;
    let request = Option.getOrUndefined(FiberMap.getUnsafe(requests, key));
    if (!request || current.status !== "loading") {
      if (!force && current.status === "ready" && !current.stale) return;
      request = effects.runFork(load(location, mode));
      FiberMap.setUnsafe(requests, key, request);
    }
    yield* Fiber.join(request).pipe(
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
    );
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
    sync: (location, mode) => start(location, mode, false),
    refresh: (location, mode) => start(location, mode, true),
  };
}
