import type { FileDiffInfo, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { locationKey } from "@opencode-ai/client/solid";
import { createSignal, onCleanup } from "solid-js";

import type { OpenCodeEventSource } from "./event-source";

export type VcsDiffMode = "working" | "branch";
export type VcsDiffStatus = "idle" | "loading" | "ready" | "failed";

export type VcsDiffSnapshot = {
  readonly files: readonly FileDiffInfo[];
  readonly status: VcsDiffStatus;
  readonly stale: boolean;
  readonly error?: string;
};

export type VcsDiffStore = {
  readonly state: (location: LocationRef, mode: VcsDiffMode) => VcsDiffSnapshot;
  readonly sync: (location: LocationRef, mode: VcsDiffMode) => Promise<void>;
  readonly refresh: (location: LocationRef, mode: VcsDiffMode) => Promise<void>;
};

type DiffEntry = {
  readonly location: LocationRef;
  readonly read: () => VcsDiffSnapshot;
  readonly write: (snapshot: VcsDiffSnapshot) => void;
};

type InFlight = {
  readonly controller: AbortController;
  readonly request: Promise<void>;
};

type VcsDiffStoreInput = {
  readonly diff: OpenCodeClient["vcs"]["diff"];
  readonly events: Pick<OpenCodeEventSource, "on">;
};

const EMPTY: VcsDiffSnapshot = {
  files: [],
  status: "idle",
  stale: false,
};

const keyOf = (location: LocationRef, mode: VcsDiffMode): string =>
  `${locationKey(location)}:${mode}`;

export function createVcsDiffStore(input: VcsDiffStoreInput): VcsDiffStore {
  const entries = new Map<string, DiffEntry>();
  const inFlight = new Map<string, InFlight>();
  const revisions = new Map<string, number>();

  const entryFor = (location: LocationRef, mode: VcsDiffMode): DiffEntry => {
    const key = keyOf(location, mode);
    const existing = entries.get(key);
    if (existing) return existing;

    const [read, write] = createSignal<VcsDiffSnapshot>(EMPTY);
    const entry = { location, read, write };
    entries.set(key, entry);
    return entry;
  };

  const invalidateEntry = (key: string, entry: DiffEntry): void => {
    revisions.set(key, (revisions.get(key) ?? 0) + 1);
    inFlight.get(key)?.controller.abort();
    inFlight.delete(key);
    const current = entry.read();
    entry.write({
      files: current.files,
      status: current.files.length > 0 ? "ready" : "idle",
      stale: true,
    });
  };

  const invalidate = (location?: LocationRef): void => {
    const target = location && locationKey(location);
    for (const [key, entry] of entries) {
      if (target !== undefined && locationKey(entry.location) !== target) continue;
      invalidateEntry(key, entry);
    }
  };

  const start = (location: LocationRef, mode: VcsDiffMode, force: boolean): Promise<void> => {
    const key = keyOf(location, mode);
    const entry = entryFor(location, mode);
    const current = entry.read();

    if (!force) {
      const pending = inFlight.get(key);
      if (pending) return pending.request;
      if (current.status === "ready" && !current.stale) return Promise.resolve();
    } else {
      invalidateEntry(key, entry);
    }

    const revision = revisions.get(key) ?? 0;
    const controller = new AbortController();
    const before = entry.read();
    entry.write({
      files: before.files,
      status: "loading",
      stale: before.stale,
    });

    const requestLocation = location.workspaceID
      ? { directory: location.directory, workspace: location.workspaceID }
      : { directory: location.directory };

    const request = input
      .diff(
        {
          location: requestLocation,
          mode,
        },
        { signal: controller.signal },
      )
      .then((response) => {
        if ((revisions.get(key) ?? 0) !== revision) return undefined;
        entry.write({ files: response.data, status: "ready", stale: false });
        return undefined;
      })
      .catch((cause: unknown) => {
        if ((revisions.get(key) ?? 0) !== revision || isAbort(cause)) return;
        entry.write({
          files: before.files,
          status: "failed",
          stale: before.files.length > 0 || before.stale,
          error: errorMessage(cause),
        });
      })
      .finally(() => {
        if (inFlight.get(key)?.request === request) inFlight.delete(key);
      });

    inFlight.set(key, { controller, request });
    return request;
  };

  const stops = [
    input.events.on("filesystem.changed", (event) => invalidate(event.location)),
    input.events.on("vcs.branch.updated", (event) => invalidate(event.location)),
    input.events.on("server.connected", () => invalidate()),
  ];

  onCleanup(() => {
    stops.forEach((stop) => stop());
    for (const request of inFlight.values()) request.controller.abort();
    inFlight.clear();
  });

  return {
    state(location, mode) {
      return entryFor(location, mode).read();
    },
    sync(location, mode) {
      return start(location, mode, false);
    },
    refresh(location, mode) {
      return start(location, mode, true);
    },
  };
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "The diff could not be loaded. Check the connection and try again.";
}
