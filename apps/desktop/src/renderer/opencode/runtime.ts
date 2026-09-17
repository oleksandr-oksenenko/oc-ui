import { createClientConnection, createData } from "@opencode/client/solid";
import type { Data, ClientConnectionStatus } from "@opencode/client/solid";
import type { LocationRef, OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { Deferred, Effect } from "effect";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import { createEffect, getOwner, onCleanup } from "solid-js";
import { createOpenCodeEventSource } from "./event-source";
import { mapConnectionFailure, type OpenCodeConnectionError } from "./connection";
import { createServerFileImages, type ServerFileImages } from "./file-images";
import { createSessionCatalog } from "./session-catalog";
import type { SessionCatalog } from "./session-catalog";
import { createTranscriptLoader } from "./transcript";
import type { TranscriptLoader } from "./transcript";
import { createVcsDiffStore } from "./vcs-diff";
import type { VcsDiffStore } from "./vcs-diff";

type RuntimeConnection = {
  readonly effects: WorkspaceOwner;
  readonly api: OpenCodeClient;
  readonly defaultLocation: LocationRef;
};

export type ConnectedRuntime = {
  readonly effects: WorkspaceOwner;
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
  /** Reads `file:` image URLs from the connected server's filesystem. */
  readonly fileImages: ServerFileImages;
  /** Resolves after the initial stream handshake and default location synchronization. */
  readonly ready: Promise<void>;
  readonly onShellExited: (
    handler: (event: Extract<OpenCodeEvent, { type: "shell.exited" }>) => void,
  ) => () => void;
  readonly loader: TranscriptLoader;
};

/**
 * Create one OpenCode data runtime. Call this from a mounted Solid component
 * or another Solid owner; the public client uses that owner for stream cleanup.
 */
export function createConnectedRuntime(input: RuntimeConnection): ConnectedRuntime {
  if (!getOwner()) {
    throw new Error("createConnectedRuntime must run inside a Solid owner");
  }

  const events = createOpenCodeEventSource();
  const stream = createClientConnection(input.api, { onEvent: events.emit });
  const data = createData({
    api: () => input.api,
    directory: input.defaultLocation.directory,
    event: events,
    connection: { status: stream.status },
  });
  const sessions = createSessionCatalog({
    effects: input.effects,
    api: input.api,
    data,
    events,
  });
  const diffs = createVcsDiffStore({ diff: input.api.vcs.diff, events, effects: input.effects });
  const fileImages = createServerFileImages({
    fileRead: input.api.file.read,
    effects: input.effects,
  });

  const handshake = Deferred.makeUnsafe<void, OpenCodeConnectionError>();
  const stopReady = events.on("server.connected", () => {
    Deferred.doneUnsafe(handshake, Effect.void);
  });

  // Deferred accepts only the first handshake result. Later reconnects remain
  // entirely owned by the public client.
  createEffect(() => {
    if (stream.status() === "reconnecting" && stream.attempt() > 0) {
      Deferred.doneUnsafe(
        handshake,
        Effect.fail(
          mapConnectionFailure(
            new Error(stream.error() ?? "The OpenCode event stream handshake failed."),
            "stream",
          ),
        ),
      );
    }
  });

  // createClientConnection and createData register their own lifecycle hooks.
  // This hook only owns the bridge created by this module.
  onCleanup(() => {
    stopReady();
    events.close();
  });

  const ready = input.effects.runPromise(
    Effect.gen(function* () {
      yield* Deferred.await(handshake);
      yield* input.effects.request(() => data.location.syncInfo(input.defaultLocation));
    }),
  );
  // A workspace can close before a view has subscribed to readiness.
  void ready.catch(() => undefined);
  const loader = createTranscriptLoader(input.effects, data);
  const onShellExited = (
    handler: (event: Extract<OpenCodeEvent, { type: "shell.exited" }>) => void,
  ): (() => void) => events.on("shell.exited", handler);

  return {
    effects: input.effects,
    api: input.api,
    data,
    defaultLocation: input.defaultLocation,
    stream,
    sessions,
    diffs,
    fileImages,
    ready,
    onShellExited,
    loader,
  };
}
