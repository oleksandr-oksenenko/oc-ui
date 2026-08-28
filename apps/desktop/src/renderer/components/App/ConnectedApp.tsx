import type { SessionInfo } from "@opencode-ai/client";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { AppShell } from "./ConnectedApp/AppShell.tsx";
import { Titlebar } from "./ConnectedApp/AppShell/Titlebar.tsx";
import { Workspace } from "./ConnectedApp/AppShell/Workspace.tsx";
import { createShellPanelState } from "./ConnectedApp/AppShell/createShellPanelState.ts";
import {
  ContextTabs,
  type ContextPanelTab,
} from "./ConnectedApp/AppShell/Workspace/ContextPanel/ContextTabs.tsx";
import { ContextPanel } from "./ConnectedApp/AppShell/Workspace/ContextPanel.tsx";
import type { DiffViewProps } from "./ConnectedApp/AppShell/Workspace/ContextPanel/DiffView.tsx";
import { SessionPane } from "./ConnectedApp/AppShell/Workspace/SessionPane.tsx";
import { SessionSidebar } from "./ConnectedApp/AppShell/Workspace/SessionSidebar.tsx";
import { NewSessionFlow } from "./ConnectedApp/AppShell/Workspace/SessionSidebar/NewSessionFlow.tsx";
import { Composer } from "./ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";
import { TranscriptView } from "./ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import { chooseSessionFallback, sessionAncestorIDs } from "./ConnectedApp/session-selection.ts";
import { createSessionDraftStore } from "../../domain/index.ts";
import { syncActiveStatuses, useServerRuntime } from "../../opencode/index.ts";
import type { VcsDiffMode, VerifiedServer } from "../../opencode/index.ts";
import {
  createReconnectRefreshQueue,
  retryCatalogAndTranscript,
} from "./ConnectedApp/sessionRecovery.ts";
import { restoreDialogFocusAfterClose } from "../../ui/restoreDialogFocusAfterClose.ts";

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
  const [newSessionOpen, setNewSessionOpen] = createSignal(false);
  const [submittingID, setSubmittingID] = createSignal<string>();
  const [promptError, setPromptError] = createSignal<string>();
  const panels = createShellPanelState({ leftSidebarOpen: true, rightPanelOpen: true });
  const [activeContextTab, setActiveContextTab] = createSignal<ContextPanelTab>("diff");
  const [diffMode, setDiffMode] = createSignal<VcsDiffMode>("working");
  const [expandedIDs, setExpandedIDs] = createSignal<readonly string[]>([]);
  let alive = true;
  let hydration = 0;
  let selectedAncestorIDs: readonly string[] = [];
  let newSessionOpener: HTMLElement | undefined;

  onCleanup(() => {
    alive = false;
    hydration += 1;
  });

  const sessions = createMemo<readonly SessionInfo[]>(() => {
    const ids = new Set(runtime.sessions.ids());
    return runtime.data.session
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

  const running = createMemo(() => {
    const id = selectedID();
    return id !== undefined && runtime.data.session.status(id) === "running";
  });

  const transcript = createMemo(() => {
    const id = selectedID();
    return id === undefined ? [] : runtime.data.session.message.list(id);
  });

  const transcriptStatus = createMemo(() => {
    const id = selectedID();
    return id === undefined ? "idle" : runtime.data.session.status(id);
  });

  const streamConnected = () => runtime.stream.status() === "connected";

  const selectedLocation = createMemo(() => selectedSession()?.location);
  const changeDiffMode = (value: string): void => {
    if (value === "working" || value === "branch") setDiffMode(value);
  };

  const diffComparisonOptions = createMemo<
    readonly { readonly value: VcsDiffMode; readonly label: string }[]
  >(() => {
    const location = selectedLocation();
    const branch = location && runtime.data.location.vcs.info(location)?.branch;
    if (branch?.current && branch.default && branch.current !== branch.default) {
      return [
        { value: "working", label: "Working changes" },
        { value: "branch", label: `Changes vs ${branch.default}` },
      ];
    }
    return [{ value: "working", label: "Working changes" }];
  });

  createEffect(() => {
    if (
      diffMode() === "branch" &&
      !diffComparisonOptions().some((option) => option.value === "branch")
    ) {
      setDiffMode("working");
    }
  });

  const diffSnapshot = createMemo(() => {
    const location = selectedLocation();
    return location ? runtime.diffs.state(location, diffMode()) : undefined;
  });

  createEffect(() => {
    const location = selectedLocation();
    if (
      !location ||
      !bootstrapped() ||
      !streamConnected() ||
      !panels.rightPanelOpen() ||
      activeContextTab() !== "diff"
    ) {
      return;
    }

    void runtime.data.location.vcs.sync(location).catch(() => undefined);
    const snapshot = runtime.diffs.state(location, diffMode());
    if (snapshot.status === "idle" || (snapshot.status === "ready" && snapshot.stale)) {
      void runtime.diffs.sync(location, diffMode());
    }
  });

  const diff = createMemo<DiffViewProps>(() => {
    const location = selectedLocation();
    const snapshot = diffSnapshot();
    const branch = location && runtime.data.location.vcs.info(location)?.branch;
    const defaultBranch = branch?.default;
    const files =
      snapshot?.files.map((file) => ({
        path: file.file,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
        status: file.status,
      })) ?? [];

    if (!location || !snapshot) {
      return {
        files,
        loading: false,
        emptyMessage: "Select a session to view changes",
        emptyDescription: "The Diff panel follows the selected session's workspace location.",
        comparison: diffMode(),
        comparisonOptions: diffComparisonOptions(),
        onComparisonChange: changeDiffMode,
      };
    }

    return {
      files,
      loading: snapshot.status === "loading",
      error: snapshot.status === "failed" ? snapshot.error : undefined,
      stale: snapshot.stale,
      emptyMessage:
        diffMode() === "branch" && defaultBranch
          ? `No changes against ${defaultBranch}`
          : "No working tree changes",
      emptyDescription:
        diffMode() === "branch" && defaultBranch
          ? `The working copy matches its merge base with ${defaultBranch}.`
          : "The working copy matches HEAD.",
      comparison: diffMode(),
      comparisonOptions: diffComparisonOptions(),
      onComparisonChange: changeDiffMode,
      onRetry: () => void runtime.diffs.refresh(location, diffMode()),
    };
  });

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

  const openNewSession = (): void => {
    newSessionOpener =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setNewSessionOpen(true);
  };

  const selectSession = (sessionID: string): void => {
    if (selectedID() === sessionID) return;
    selectedAncestorIDs = sessionAncestorIDs(sessionID, sessions());
    setSelectedID(sessionID);
    setPromptError(undefined);
    void hydrateTranscript(sessionID);
  };

  const syncCatalog = async (): Promise<void> => {
    await runtime.sessions.sync();
    await syncActiveStatuses({
      api: runtime.api,
      data: runtime.data,
      sessionIDs: runtime.sessions.ids(),
    });
  };

  onMount(() => {
    void (async () => {
      try {
        await runtime.ready;
        await runtime.data.location.syncInfo(runtime.defaultLocation);
        if (!alive) return;
        props.onConnected();
        setBootstrapped(true);
        await syncCatalog().catch(() => undefined);
      } catch (cause) {
        if (alive) props.onInitialFailure(cause);
      }
    })();
  });

  const reconnectRefresh = createReconnectRefreshQueue(
    async () => {
      const previous = selectedID();
      if (previous) setTranscriptState({ sessionID: previous, status: "loading" });
      try {
        await runtime.data.location.syncInfo(runtime.defaultLocation);
        await syncCatalog();
        if (!alive) return;
        const current = selectedID();
        if (current === undefined) {
          setTranscriptState({ status: "idle" });
        } else if (!runtime.sessions.ids().includes(current)) {
          // The selection effect will choose and hydrate the nearest surviving ancestor.
          return;
        } else if (current === previous) {
          await hydrateTranscript(current);
        }
      } catch {
        if (!alive) return;
        setTranscriptState({
          sessionID: selectedID(),
          status: "failed",
          error: "The session could not be refreshed after reconnecting.",
        });
      }
    },
    () => alive && streamConnected(),
  );

  createEffect(() => {
    const status = runtime.stream.status();
    if (!bootstrapped()) return;
    if (status !== "connected") {
      reconnectRefresh.markDisconnected();
      return;
    }
    reconnectRefresh.refreshIfPending();
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
    if (current && runtime.sessions.ids().includes(current)) {
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
    } else {
      selectSession(next);
    }
  });

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

  const retryCatalog = async (): Promise<void> => {
    await retryCatalogAndTranscript(
      syncCatalog,
      () => {
        if (!alive) return undefined;
        const current = selectedID();
        return current !== undefined && runtime.sessions.ids().includes(current)
          ? current
          : undefined;
      },
      hydrateTranscript,
    );
  };

  return (
    <>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle={selectedSession()?.title}
            leftSidebarOpen={panels.leftSidebarOpen()}
            rightPanelOpen={panels.rightPanelOpen()}
            rightPanelAvailable
            rightControls={
              <Show when={!panels.mobile()}>
                <ContextTabs
                  activeTab={activeContextTab()}
                  idBase="connected-workspace-context"
                  onTabChange={setActiveContextTab}
                  onClose={() => panels.setRightPanelOpen(false)}
                />
              </Show>
            }
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
                sessions={sessions()}
                statusForSession={(sessionID) => runtime.data.session.status(sessionID)}
                selectedID={selectedID()}
                expandedIDs={expandedIDs()}
                loading={runtime.sessions.state() === "loading"}
                error={runtime.sessions.error()}
                canCreate={streamConnected() && runtime.sessions.state() === "ready"}
                autoFocusClose={panels.mobile()}
                serverName={friendlyServerName(props.server.serverUrl)}
                serverStatus={streamConnected() ? "connected" : "reconnecting"}
                onSelect={(sessionID) => {
                  if (!streamConnected()) return;
                  selectSession(sessionID);
                  if (panels.mobile()) panels.setLeftSidebarOpen(false);
                }}
                onToggleExpanded={toggleExpanded}
                onCreate={openNewSession}
                onRetry={() => void retryCatalog().catch(() => undefined)}
                onHide={panels.mobile() ? () => panels.setLeftSidebarOpen(false) : undefined}
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
                      messages={transcript()}
                      sessionStatus={transcriptStatus()}
                      loading={transcriptLoading()}
                      error={transcriptError()}
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
            context={
              <ContextPanel
                activeTab={activeContextTab()}
                showTabs={panels.mobile()}
                onTabChange={setActiveContextTab}
                onClose={() => panels.setRightPanelOpen(false)}
                diff={diff()}
              />
            }
          />
        }
      />
      <Show when={newSessionOpen()}>
        <NewSessionFlow
          runtime={runtime}
          onDismiss={() => {
            setNewSessionOpen(false);
            restoreDialogFocusAfterClose(() => newSessionOpener);
          }}
          onSessionCreated={(sessionID) => {
            setSelectedID(sessionID);
            setTranscriptState({ sessionID, status: "ready" });
            if (panels.mobile()) panels.setLeftSidebarOpen(false);
          }}
        />
      </Show>
    </>
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
