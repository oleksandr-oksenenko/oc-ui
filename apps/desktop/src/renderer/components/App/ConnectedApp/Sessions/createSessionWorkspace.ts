import type { SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { useAtomValue } from "@effect/atom-solid";
import { Effect, Fiber, Semaphore } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, untrack, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import type { SessionCatalog } from "../../../../opencode/session-catalog.ts";
import { syncActiveStatuses } from "../../../../opencode/session-catalog.ts";
import { chooseSessionFallback, sessionAncestorIDs } from "./session-selection.ts";

type SessionMessage = ReturnType<ConnectedRuntime["data"]["session"]["message"]["list"]>[number];

type TranscriptState = {
  readonly sessionID?: string;
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly error?: string;
};

export type SessionWorkspaceRuntime = {
  readonly api: {
    readonly session: Pick<ConnectedRuntime["api"]["session"], "active" | "interrupt">;
  };
  readonly data: {
    readonly session: Pick<ConnectedRuntime["data"]["session"], "list" | "status" | "setStatus"> & {
      readonly message: Pick<ConnectedRuntime["data"]["session"]["message"], "list">;
    };
  };
  readonly sessions: Pick<SessionCatalog, "ids" | "state" | "sync" | "remove">;
  readonly memory: Pick<ConnectedRuntime["memory"], "touchSelection">;
  readonly loader: ConnectedRuntime["loader"];
};

export type SessionWorkspace = {
  readonly sessions: Accessor<readonly SessionInfo[]>;
  readonly selectedID: Accessor<string | undefined>;
  readonly selectedSession: Accessor<SessionInfo | undefined>;
  readonly running: Accessor<boolean>;
  readonly stopError: Accessor<string | undefined>;
  readonly transcript: Accessor<readonly SessionMessage[]>;
  readonly transcriptStatus: Accessor<DataSessionStatus>;
  readonly transcriptLoading: Accessor<boolean>;
  readonly transcriptError: Accessor<string | undefined>;
  readonly select: (sessionID: string) => void;
  readonly stop: () => Promise<void>;
  readonly hydrate: (sessionID: string) => Promise<void>;
  readonly syncCatalog: () => Promise<void>;
  readonly retryCatalog: () => Promise<void>;
  readonly beginRecovery: () => void;
  readonly refreshAfterReconnect: () => Promise<void>;
  readonly failRecovery: () => void;
  readonly markCreated: (sessionID: string) => void;
  readonly remove: (sessionIDs: readonly string[]) => void;
};

export type CreateSessionWorkspaceInput = {
  readonly effects: WorkspaceOwner;
  readonly runtime: SessionWorkspaceRuntime;
  readonly connected: Accessor<boolean>;
  readonly bootstrapped: Accessor<boolean>;
};

/** Owns the selected session and its server-backed transcript lifecycle. */
export function createSessionWorkspace(input: CreateSessionWorkspaceInput): SessionWorkspace {
  const { effects } = input;
  const selectionAtom = Atom.make<{ id?: string; ancestors: readonly string[] }>({ ancestors: [] });
  const transcriptAtom = Atom.make<TranscriptState>({ status: "idle" });
  const stopErrorAtom = Atom.make<string | undefined>(undefined);
  const recoveryAtom = Atom.make<string | undefined>(undefined);
  effects.mount(selectionAtom);
  effects.mount(transcriptAtom);
  effects.mount(stopErrorAtom);
  effects.mount(recoveryAtom);
  const selection = useAtomValue(() => selectionAtom);
  const selectedID = createMemo(() => selection().id);
  const transcriptState = useAtomValue(() => transcriptAtom);
  const stopError = useAtomValue(() => stopErrorAtom);
  const setTranscriptState = (state: TranscriptState) =>
    effects.registry.set(transcriptAtom, state);
  const stopping = Semaphore.makeUnsafe(1);
  const hydration = effects.latest();

  const sessions = createMemo<readonly SessionInfo[]>(() => {
    const ids = new Set(input.runtime.sessions.ids());
    return input.runtime.data.session
      .list()
      .filter((session) => ids.has(session.id))
      .toSorted(
        (left, right) => right.time.updated - left.time.updated || left.id.localeCompare(right.id),
      );
  });

  const selectedSession = createMemo(() => {
    const id = selectedID();
    return id === undefined ? undefined : sessions().find((session) => session.id === id);
  });

  const transcriptStatus = createMemo<DataSessionStatus>(() => {
    const id = selectedID();
    return id === undefined ? "idle" : input.runtime.data.session.status(id);
  });

  const running = createMemo(() => transcriptStatus() === "running");

  const stop = (): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        const sessionID = selectedID();
        if (
          sessionID === undefined ||
          !input.connected() ||
          input.runtime.data.session.status(sessionID) !== "running"
        )
          return;
        yield* Effect.gen(function* () {
          effects.registry.set(stopErrorAtom, undefined);
          yield* effects.request((signal) =>
            input.runtime.api.session.interrupt({ sessionID }, { signal }),
          );
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              if (selectedID() === sessionID)
                effects.registry.set(stopErrorAtom, "The session could not be stopped. Try again.");
            }),
          ),
          stopping.withPermitsIfAvailable(1),
        );
      }),
    );

  const transcript = createMemo<readonly SessionMessage[]>(() => {
    const id = selectedID();
    return id === undefined ? [] : input.runtime.data.session.message.list(id);
  });

  const hydrate = (sessionID: string): Promise<void> => {
    // A stale request must not replace the current selection's work or state.
    if (selectedID() !== sessionID) return Promise.resolve();
    setTranscriptState({ sessionID, status: "loading" });
    const fiber = hydration.run(
      Effect.gen(function* () {
        yield* input.runtime.loader.load(sessionID);
        if (selectedID() === sessionID) setTranscriptState({ sessionID, status: "ready" });
      }).pipe(
        // Interruption bypasses this handler, so a superseded load cannot
        // report a failure or a ready state.
        Effect.catch(() =>
          Effect.sync(() => {
            if (selectedID() === sessionID)
              setTranscriptState({
                sessionID,
                status: "failed",
                error: "This transcript could not be loaded. Check the connection and try again.",
              });
          }),
        ),
      ),
    );
    // UI cancellation settles the wait; the loader still owns native cleanup.
    return effects.runPromise(Fiber.await(fiber)).then(
      () => undefined,
      () => undefined,
    );
  };

  const selectSession = (sessionID: string): void => {
    if (selectedID() === sessionID) return;
    effects.registry.set(selectionAtom, {
      id: sessionID,
      ancestors: sessionAncestorIDs(sessionID, sessions()),
    });
    setTranscriptState({ status: "idle" });
    void hydrate(sessionID);
  };

  const select = (sessionID: string): void => {
    if (!input.connected()) return;
    selectSession(sessionID);
  };

  const syncCatalog = Effect.gen(function* () {
    yield* Effect.tryPromise(input.runtime.sessions.sync);
    yield* syncActiveStatuses({
      effects,
      api: input.runtime.api,
      data: input.runtime.data,
      sessionIDs: input.runtime.sessions.ids(),
    });
  });

  const retryCatalog = (): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        yield* syncCatalog;
        const current = selectedID();
        if (current !== undefined && input.runtime.sessions.ids().includes(current)) {
          yield* Effect.tryPromise(() => hydrate(current));
        }
      }),
    );

  const beginRecovery = (): void => {
    const current = selectedID();
    hydration.cancel();
    effects.registry.set(recoveryAtom, current);
    if (current !== undefined) setTranscriptState({ sessionID: current, status: "loading" });
  };

  const refreshAfterReconnect = (): Promise<void> =>
    effects.runPromise(
      Effect.gen(function* () {
        yield* syncCatalog;
        const current = selectedID();
        if (current === undefined) {
          effects.registry.set(recoveryAtom, undefined);
          setTranscriptState({ status: "idle" });
          return;
        }
        if (current !== effects.registry.get(recoveryAtom)) {
          effects.registry.set(recoveryAtom, undefined);
          return;
        }
        if (!input.runtime.sessions.ids().includes(current)) return;
        effects.registry.set(recoveryAtom, undefined);
        yield* Effect.tryPromise(() => hydrate(current));
      }),
    );

  const failRecovery = (): void => {
    const recoveredID = effects.registry.get(recoveryAtom);
    effects.registry.set(recoveryAtom, undefined);
    if (recoveredID === undefined || selectedID() !== recoveredID) return;
    setTranscriptState({
      sessionID: recoveredID,
      status: "failed",
      error: "The session could not be refreshed after reconnecting.",
    });
  };

  const markCreated = (sessionID: string): void => {
    hydration.cancel();
    effects.registry.set(selectionAtom, {
      id: sessionID,
      ancestors: sessionAncestorIDs(sessionID, sessions()),
    });
    setTranscriptState({ sessionID, status: "ready" });
  };

  const remove = (sessionIDs: readonly string[]): void => {
    for (const sessionID of sessionIDs) input.runtime.sessions.remove(sessionID);
  };

  createEffect(() => {
    selectedID();
    effects.registry.set(stopErrorAtom, undefined);
  });

  // One observer covers every selection writer: direct selection, creation,
  // catalog fallback, and clearing. Keep policy reads out of the dependency graph.
  createEffect(
    on(selectedID, (id) => {
      untrack(() => input.runtime.memory.touchSelection(id));
    }),
  );

  createEffect(() => {
    if (input.runtime.sessions.state() !== "ready") return;
    const current = selectedID();
    if (current && input.runtime.sessions.ids().includes(current)) {
      const currentSessions = sessions();
      if (currentSessions.some((session) => session.id === current)) {
        effects.registry.set(selectionAtom, {
          id: current,
          ancestors: sessionAncestorIDs(current, currentSessions),
        });
      }
      return;
    }
    const next = chooseSessionFallback(effects.registry.get(selectionAtom).ancestors, sessions());
    if (next === undefined) {
      hydration.cancel();
      effects.registry.set(selectionAtom, { ancestors: [] });
      setTranscriptState({ status: "idle" });
      return;
    }
    selectSession(next);
  });

  createEffect(
    on(
      () => [selectedID(), transcriptStatus()] as const,
      ([id, status], previous) => {
        if (
          input.bootstrapped() &&
          input.connected() &&
          id !== undefined &&
          previous?.[0] === id &&
          previous[1] === "running" &&
          status !== "running"
        ) {
          void hydrate(id);
        }
      },
    ),
  );

  const transcriptLoading = createMemo(() => {
    const state = transcriptState();
    return state.sessionID === selectedID() && state.status === "loading";
  });

  const transcriptError = (): string | undefined => {
    const state = transcriptState();
    return state.sessionID === selectedID() && state.status === "failed" ? state.error : undefined;
  };

  return {
    sessions,
    selectedID,
    selectedSession,
    running,
    stopError,
    transcript,
    transcriptStatus,
    transcriptLoading,
    transcriptError,
    select,
    stop,
    hydrate,
    syncCatalog: () => effects.runPromise(syncCatalog),
    retryCatalog,
    beginRecovery,
    refreshAfterReconnect,
    failRecovery,
    markCreated,
    remove,
  };
}
