import type { SessionInfo } from "@opencode-ai/client";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { AppShell } from "./ConnectedApp/AppShell.tsx";
import { Titlebar } from "./ConnectedApp/AppShell/Titlebar.tsx";
import { Workspace } from "./ConnectedApp/AppShell/Workspace.tsx";
import { createShellPanelState } from "./ConnectedApp/AppShell/createShellPanelState.ts";
import { SessionPane } from "./ConnectedApp/AppShell/Workspace/SessionPane.tsx";
import { SessionHeader } from "./ConnectedApp/AppShell/Workspace/SessionSidebar/SessionHeader.tsx";
import {
  SessionSidebar,
  type SessionNode,
} from "./ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";
import { Composer } from "./ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";
import { TranscriptView } from "./ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import {
  projectRuntimeSessionNodes,
  projectRuntimeTranscript,
} from "./ConnectedApp/runtime-projection.ts";
import { createSessionDraftStore, projectTranscript } from "../../domain/index.ts";
import { syncActiveStatuses, useServerRuntime } from "../../opencode/index.ts";
import type { VerifiedServer } from "../../opencode/index.ts";

export type ConnectedAppProps = {
  readonly server: VerifiedServer;
  readonly onConnected: () => void;
  readonly onInitialFailure: (cause: unknown) => void;
  readonly onChangeServer: () => void;
};

/** The sole OpenCode-backed controller for the connected workspace. */
export function ConnectedApp(props: ConnectedAppProps) {
  const runtime = useServerRuntime();
  const drafts = createSessionDraftStore();
  const [bootstrapped, setBootstrapped] = createSignal(false);
  const [selectedID, setSelectedID] = createSignal<string>();
  const [transcriptState, setTranscriptState] = createSignal<{
    readonly sessionID?: string;
    readonly status: "idle" | "loading" | "ready" | "failed";
    readonly error?: string;
  }>({ status: "idle" });
  const [creating, setCreating] = createSignal(false);
  const [creatingID, setCreatingID] = createSignal<string>();
  const [createError, setCreateError] = createSignal<string>();
  const [submittingID, setSubmittingID] = createSignal<string>();
  const [promptError, setPromptError] = createSignal<string>();
  const panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: false });
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([]);
  let alive = true;
  let hydration = 0;

  onCleanup(() => {
    alive = false;
    hydration += 1;
  });

  const sessions = createMemo<readonly SessionInfo[]>(() => {
    const ids = new Set(runtime.sessions.ids());
    return runtime.data.session
      .list()
      .filter((session) => ids.has(session.id))
      .toSorted((left, right) => right.time.updated - left.time.updated);
  });

  const selectedSession = createMemo(() => {
    const id = selectedID();
    return id === undefined ? undefined : sessions().find((session) => session.id === id);
  });

  const running = createMemo(() => {
    const id = selectedID();
    return id !== undefined && runtime.data.session.status(id) === "running";
  });

  const transcript = createMemo(() => {
    const id = selectedID();
    if (id === undefined) return [];
    return projectRuntimeTranscript(
      projectTranscript(runtime.data.session.message.list(id), runtime.data.session.status(id)),
    );
  });

  const sessionNodes = createMemo<readonly SessionNode[]>(() =>
    projectRuntimeSessionNodes(
      sessions(),
      (sessionID) => runtime.data.session.status(sessionID),
      creatingID(),
    ),
  );

  const streamConnected = () => runtime.stream.status() === "connected";

  const hydrateTranscript = async (sessionID: string): Promise<void> => {
    const currentHydration = ++hydration;
    setTranscriptState({ sessionID, status: "loading" });
    try {
      await runtime.syncTranscript(sessionID, {
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
    setSelectedID(sessionID);
    setPromptError(undefined);
    void hydrateTranscript(sessionID);
  };

  const syncCatalog = async (): Promise<void> => {
    try {
      await runtime.sessions.sync();
      await syncActiveStatuses({
        api: runtime.api,
        data: runtime.data,
        sessionIDs: runtime.sessions.ids(),
      });
      if (!alive) return;
      const current = selectedID();
      const next =
        current && runtime.sessions.ids().includes(current) ? current : sessions()[0]?.id;
      if (next === undefined) {
        setSelectedID(undefined);
        setTranscriptState({ status: "idle" });
      } else if (next !== current) {
        selectSession(next);
      } else {
        void hydrateTranscript(next);
      }
    } catch {
      // The catalog owns its retryable error state.
    }
  };

  onMount(() => {
    void (async () => {
      try {
        await runtime.ready;
        await runtime.data.location.syncInfo(runtime.defaultLocation);
        if (!alive) return;
        props.onConnected();
        setBootstrapped(true);
        await syncCatalog();
      } catch (cause) {
        if (alive) props.onInitialFailure(cause);
      }
    })();
  });

  let reconnectPending = false;
  let reconnecting = false;
  createEffect(() => {
    const status = runtime.stream.status();
    if (!bootstrapped()) return;
    if (status !== "connected") {
      reconnectPending = true;
      return;
    }
    if (!reconnectPending || reconnecting) return;
    reconnectPending = false;
    reconnecting = true;
    const current = selectedID();
    if (current) setTranscriptState({ sessionID: current, status: "loading" });
    void (async () => {
      try {
        const next = await runtime.hydrateAfterReconnect(current);
        if (!alive) return;
        setSelectedID(next);
        setTranscriptState(next ? { sessionID: next, status: "ready" } : { status: "idle" });
      } catch {
        if (!alive) return;
        setTranscriptState({
          sessionID: selectedID(),
          status: "failed",
          error: "The session could not be refreshed after reconnecting.",
        });
      } finally {
        reconnecting = false;
      }
    })();
  });

  let previousRunning = false;
  let previousRunningID: string | undefined;
  createEffect(() => {
    const id = selectedID();
    const isRunning = id !== undefined && runtime.data.session.status(id) === "running";
    if (
      bootstrapped() &&
      streamConnected() &&
      id !== undefined &&
      id === previousRunningID &&
      previousRunning &&
      !isRunning
    ) {
      void hydrateTranscript(id);
    }
    previousRunningID = id;
    previousRunning = isRunning;
  });

  createEffect(() => {
    if (runtime.sessions.state() !== "ready") return;
    const current = selectedID();
    if (current && runtime.sessions.ids().includes(current)) return;
    const next = sessions()[0]?.id;
    setSelectedID(next);
    if (next) void hydrateTranscript(next);
  });

  const createSession = async (): Promise<void> => {
    if (!streamConnected() || creating()) return;
    const previous = selectedID();
    setCreating(true);
    setCreateError(undefined);
    const created = runtime.data.session.create({ location: runtime.defaultLocation });
    runtime.sessions.admit(created.id);
    setCreatingID(created.id);
    setSelectedID(created.id);
    setTranscriptState({ sessionID: created.id, status: "ready" });
    try {
      await created.request;
    } catch {
      runtime.sessions.remove(created.id);
      const fallback =
        previous && runtime.sessions.ids().includes(previous) ? previous : sessions()[0]?.id;
      setSelectedID(fallback);
      setCreateError("The session could not be created. Try again.");
      if (fallback) void hydrateTranscript(fallback);
    } finally {
      setCreating(false);
      setCreatingID(undefined);
    }
  };

  const submitPrompt = async (): Promise<void> => {
    const sessionID = selectedID();
    if (sessionID === undefined || submittingID() !== undefined || running() || !streamConnected())
      return;
    const text = drafts.get(sessionID);
    if (text.trim() === "") return;
    setPromptError(undefined);
    setSubmittingID(sessionID);
    try {
      await runtime.data.session.prompt({ sessionID, text });
      drafts.clearIfUnchanged(sessionID, text);
    } catch {
      setPromptError("The prompt was not admitted. Your draft has been kept.");
    } finally {
      setSubmittingID(undefined);
    }
  };

  const transcriptLoading = () => {
    const state = transcriptState();
    return state.sessionID === selectedID() && state.status === "loading";
  };

  const transcriptError = () => {
    const state = transcriptState();
    return state.sessionID === selectedID() && state.status === "failed" ? state.error : undefined;
  };

  const toggleExpanded = (id: string): void => {
    setExpandedIDs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <AppShell
      titlebar={
        <Titlebar
          selectedTitle={selectedSession()?.title}
          leftControls={
            <SessionHeader
              canCreate={streamConnected() && runtime.sessions.state() === "ready"}
              creating={creating()}
              onCreate={() => void createSession()}
              onHide={() => panels.setLeftSidebarOpen(false)}
            />
          }
          leftSidebarOpen={panels.leftSidebarOpen()}
          rightPanelOpen={panels.rightPanelOpen()}
          rightPanelAvailable={false}
          mobile={panels.mobile()}
          onToggleLeftSidebar={panels.toggleLeftSidebar}
          onToggleRightPanel={panels.toggleRightPanel}
        />
      }
      workspace={
        <Workspace
          leftSidebarOpen={panels.leftSidebarOpen()}
          rightPanelOpen={panels.rightPanelOpen()}
          mobile={panels.mobile()}
          sidebar={
            <SessionSidebar
              nodes={sessionNodes()}
              selectedID={selectedID()}
              expandedIDs={expandedIDs()}
              loading={runtime.sessions.state() === "loading"}
              error={createError() ?? runtime.sessions.error()}
              canCreate={streamConnected() && runtime.sessions.state() === "ready"}
              creating={creating()}
              showHeader={panels.mobile()}
              autoFocusClose={panels.mobile()}
              serverName={friendlyServerName(props.server.serverUrl)}
              serverStatus={streamConnected() ? "connected" : "reconnecting"}
              onSelect={(sessionID) => {
                if (!streamConnected()) return;
                selectSession(sessionID);
                if (panels.mobile()) panels.setLeftSidebarOpen(false);
              }}
              onToggleExpanded={toggleExpanded}
              onCreate={() => void createSession()}
              onRetry={() => {
                if (createError()) void createSession();
                else void syncCatalog();
              }}
              onHide={() => panels.setLeftSidebarOpen(false)}
              onSelectServer={props.onChangeServer}
            />
          }
          main={
            <SessionPane
              selected={selectedSession() !== undefined}
              title={selectedSession()?.title}
              noSelection={
                <>
                  <h2>No session selected</h2>
                  <p>Select a session from the sidebar.</p>
                </>
              }
              transcript={
                <Show when={selectedSession()}>
                  <TranscriptView
                    items={transcript()}
                    loading={transcriptLoading()}
                    error={transcriptError()}
                    working={running()}
                    onRetry={() => {
                      const id = selectedID();
                      if (id) void hydrateTranscript(id);
                    }}
                  />
                </Show>
              }
              composer={
                <Show when={selectedSession()}>
                  <Composer
                    value={drafts.get(selectedID()!)}
                    disabled={
                      !streamConnected() ||
                      transcriptLoading() ||
                      submittingID() !== undefined ||
                      running()
                    }
                    submitting={submittingID() === selectedID()}
                    running={running()}
                    error={promptError()}
                    onInput={(value) => drafts.set(selectedID()!, value)}
                    onSubmit={() => void submitPrompt()}
                  />
                </Show>
              }
            />
          }
        />
      }
    />
  );
}

function friendlyServerName(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) {
      return "Local server";
    }
    return url.hostname;
  } catch {
    return serverUrl;
  }
}
