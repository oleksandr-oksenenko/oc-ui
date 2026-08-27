import { createClientConnection, createData } from "@opencode-ai/client/solid";
import type { Data, ClientConnectionStatus } from "@opencode-ai/client/solid";
import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { createEffect, getOwner, onCleanup } from "solid-js";
import { createOpenCodeEventSource } from "./event-source";
import type { OpenCodeEventSource } from "./event-source";
import { mapConnectionFailure } from "./connection";
import { createSessionCatalog } from "./session-catalog";
import type { SessionCatalog } from "./session-catalog";
import { syncSessionTranscript } from "./transcript";
import { createVcsDiffStore } from "./vcs-diff";
import type { VcsDiffStore } from "./vcs-diff";

type RuntimeConnection = {
  readonly api: OpenCodeClient;
  readonly defaultLocation: LocationRef;
};

export type ConnectedRuntime = {
  readonly api: OpenCodeClient;
  readonly data: Data;
  readonly defaultLocation: LocationRef;
  readonly stream: {
    readonly status: () => ClientConnectionStatus;
    readonly attempt: () => number;
    readonly error: () => string | undefined;
  };
  readonly sessions: SessionCatalog;
  readonly diffs: VcsDiffStore;
  /** Resolves after the event stream receives its first server.connected event. */
  readonly ready: Promise<void>;
  readonly syncTranscript: (
    sessionID: string,
    options?: { readonly isCurrent?: () => boolean },
  ) => Promise<void>;
};

type RuntimeFactoryInput = RuntimeConnection & {
  readonly events?: OpenCodeEventSource;
};

/**
 * Create one OpenCode data runtime. Call this from a mounted Solid component
 * or another Solid owner; the public client uses that owner for stream cleanup.
 */
export function createConnectedRuntime(input: RuntimeFactoryInput): ConnectedRuntime {
  if (!getOwner()) {
    throw new Error("createConnectedRuntime must run inside a Solid owner");
  }

  const events = input.events ?? createOpenCodeEventSource();
  const stream = createClientConnection(input.api, { onEvent: events.emit });
  const data = createData({
    api: () => input.api,
    directory: input.defaultLocation.directory,
    event: events,
    connection: { status: stream.status },
  });
  const sessions = createSessionCatalog({
    api: input.api,
    data,
    events,
  });
  const diffs = createVcsDiffStore({ diff: input.api.vcs.diff, events });

  let resolveReady!: () => void;
  let rejectReady!: (cause: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let connected = false;
  const stopReady = events.on("server.connected", () => {
    if (connected) return;
    connected = true;
    resolveReady();
    // createData also preloads location on this event. This explicit call
    // makes the remote workspace-aware default location authoritative here.
    void data.location.syncInfo(input.defaultLocation).catch(() => undefined);
  });

  // The first failed handshake is terminal for initial setup. Once connected,
  // the public client owns retries and exposes reconnecting status to callers.
  createEffect(() => {
    if (!connected && stream.status() === "reconnecting" && stream.attempt() > 0) {
      rejectReady(
        mapConnectionFailure(
          new Error(stream.error() ?? "The OpenCode event stream handshake failed."),
          "stream",
        ),
      );
    }
  });

  // createClientConnection and createData register their own lifecycle hooks.
  // This hook only owns the bridge created by this module.
  onCleanup(() => {
    stopReady();
    if (!input.events) events.close();
  });

  const syncTranscript = (sessionID: string, options?: { readonly isCurrent?: () => boolean }) =>
    syncSessionTranscript(data, sessionID, options);

  return {
    api: input.api,
    data,
    defaultLocation: input.defaultLocation,
    stream,
    sessions,
    diffs,
    ready,
    syncTranscript,
  };
}
