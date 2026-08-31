import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import type { SessionCatalog } from "../../../../opencode/session-catalog.ts";
import { syncActiveStatuses } from "../../../../opencode/session-catalog.ts";
import { chooseSessionFallback, sessionAncestorIDs } from "./session-selection.ts";
import { retryCatalogAndTranscript } from "./sessionRecovery.ts";

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
  readonly syncTranscript: ConnectedRuntime["syncTranscript"];
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
  readonly runtime: SessionWorkspaceRuntime;
  readonly connected: Accessor<boolean>;
  readonly bootstrapped: Accessor<boolean>;
};

/** Owns the selected session and its server-backed transcript lifecycle. */
export function createSessionWorkspace(input: CreateSessionWorkspaceInput): SessionWorkspace {
  const [selectedID, setSelectedID] = createSignal<string>();
  const [transcriptState, setTranscriptState] = createSignal<TranscriptState>({ status: "idle" });
  const [stopError, setStopError] = createSignal<string>();
  let stoppingID: string | undefined;
  let alive = true;
  let hydration = 0;
  let selectedAncestorIDs: readonly string[] = [];
  let recoveryPreviousID: string | undefined;

  onCleanup(() => {
    alive = false;
    hydration += 1;
  });

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

  const stop = async (): Promise<void> => {
    const sessionID = selectedID();
    if (
      sessionID === undefined ||
      !input.connected() ||
      input.runtime.data.session.status(sessionID) !== "running" ||
      stoppingID !== undefined
    ) {
      return;
    }

    setStopError(undefined);
    stoppingID = sessionID;
    try {
      await input.runtime.api.session.interrupt({ sessionID });
    } catch {
      if (selectedID() === sessionID) {
        setStopError("The session could not be stopped. Try again.");
      }
    } finally {
      stoppingID = undefined;
    }
  };

  const transcript = createMemo<readonly SessionMessage[]>(() => {
    const id = selectedID();
    return id === undefined ? [] : input.runtime.data.session.message.list(id);
  });

  const hydrate = async (sessionID: string): Promise<void> => {
    const currentHydration = ++hydration;
    setTranscriptState({ sessionID, status: "loading" });
    try {
      await input.runtime.syncTranscript(sessionID, {
        isCurrent: () => alive && currentHydration === hydration && selectedID() === sessionID,
      });
      if (!alive || currentHydration !== hydration || selectedID() !== sessionID) return;
      setTranscriptState({ sessionID, status: "ready" });
    } catch {
      if (!alive || currentHydration !== hydration || selectedID() !== sessionID) return;
      setTranscriptState({
        sessionID,
        status: "failed",
        error: "This transcript could not be loaded. Check the connection and try again.",
      });
    }
  };

  const selectSession = (sessionID: string): void => {
    if (selectedID() === sessionID) return;
    selectedAncestorIDs = sessionAncestorIDs(sessionID, sessions());
    setSelectedID(sessionID);
    setTranscriptState({ status: "idle" });
    void hydrate(sessionID);
  };

  const select = (sessionID: string): void => {
    if (!input.connected()) return;
    selectSession(sessionID);
  };

  const syncCatalog = async (): Promise<void> => {
    await input.runtime.sessions.sync();
    await syncActiveStatuses({
      api: input.runtime.api,
      data: input.runtime.data,
      sessionIDs: input.runtime.sessions.ids(),
    });
  };

  const retryCatalog = async (): Promise<void> => {
    await retryCatalogAndTranscript(
      syncCatalog,
      () => {
        if (!alive) return undefined;
        const current = selectedID();
        return current !== undefined && input.runtime.sessions.ids().includes(current)
          ? current
          : undefined;
      },
      hydrate,
    );
  };

  const beginRecovery = (): void => {
    const current = selectedID();
    recoveryPreviousID = current;
    if (current !== undefined) setTranscriptState({ sessionID: current, status: "loading" });
  };

  const refreshAfterReconnect = async (): Promise<void> => {
    await syncCatalog();
    if (!alive) return;
    const current = selectedID();
    if (current === undefined) {
      recoveryPreviousID = undefined;
      setTranscriptState({ status: "idle" });
      return;
    }
    if (current !== recoveryPreviousID) {
      recoveryPreviousID = undefined;
      return;
    }
    if (!input.runtime.sessions.ids().includes(current)) return;
    recoveryPreviousID = undefined;
    await hydrate(current);
  };

  const failRecovery = (): void => {
    if (!alive) return;
    const recoveredID = recoveryPreviousID;
    recoveryPreviousID = undefined;
    if (recoveredID === undefined || selectedID() !== recoveredID) return;
    setTranscriptState({
      sessionID: recoveredID,
      status: "failed",
      error: "The session could not be refreshed after reconnecting.",
    });
  };

  const markCreated = (sessionID: string): void => {
    selectedAncestorIDs = sessionAncestorIDs(sessionID, sessions());
    setSelectedID(sessionID);
    setTranscriptState({ sessionID, status: "ready" });
  };

  const remove = (sessionIDs: readonly string[]): void => {
    for (const sessionID of sessionIDs) input.runtime.sessions.remove(sessionID);
  };

  createEffect(() => {
    selectedID();
    setStopError(undefined);
  });

  createEffect(() => {
    if (input.runtime.sessions.state() !== "ready") return;
    const current = selectedID();
    if (current && input.runtime.sessions.ids().includes(current)) {
      const currentSessions = sessions();
      if (currentSessions.some((session) => session.id === current)) {
        selectedAncestorIDs = sessionAncestorIDs(current, currentSessions);
      }
      return;
    }
    const next = chooseSessionFallback(selectedAncestorIDs, sessions());
    if (next === undefined) {
      selectedAncestorIDs = [];
      setSelectedID(undefined);
      setTranscriptState({ status: "idle" });
      return;
    }
    selectSession(next);
  });

  let previousRunning = false;
  let previousRunningID: string | undefined;
  createEffect(() => {
    const id = selectedID();
    const isRunning = id !== undefined && input.runtime.data.session.status(id) === "running";
    if (
      input.bootstrapped() &&
      input.connected() &&
      id !== undefined &&
      id === previousRunningID &&
      previousRunning &&
      !isRunning
    ) {
      void hydrate(id);
    }
    previousRunningID = id;
    previousRunning = isRunning;
  });

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
    syncCatalog,
    retryCatalog,
    beginRecovery,
    refreshAfterReconnect,
    failRecovery,
    markCreated,
    remove,
  };
}
