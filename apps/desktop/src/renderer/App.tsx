import type { SessionInfo } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { Composer } from "./components/Composer.tsx";
import { ConnectionBar } from "./components/ConnectionBar.tsx";
import { ConnectionForm } from "./components/ConnectionForm.tsx";
import { SessionSidebar } from "./components/SessionSidebar.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { createSessionDraftStore, projectTranscript } from "./domain/index.ts";
import {
  OpenCodeConnectionError,
  ServerProvider,
  syncActiveStatuses,
  useServerRuntime,
  verifyServer,
} from "./opencode/index.ts";
import type { VerifiedServer } from "./opencode/index.ts";

type ConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly status: "failed"; readonly message: string };

export function App() {
  const [serverUrl, setServerUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [candidate, setCandidate] = createSignal<VerifiedServer>();
  const [connection, setConnection] = createSignal<ConnectionState>({ status: "disconnected" });
  let attempt = 0;
  let pendingPassword = "";

  const connecting = () => connection().status === "connecting";
  const connectionError = () => {
    const state = connection();
    return state.status === "failed" ? state.message : undefined;
  };

  const connect = async (): Promise<void> => {
    const currentAttempt = ++attempt;
    const input = { serverUrl: serverUrl(), password: password() };
    setConnection({ status: "connecting" });
    try {
      const verified = await verifyServer(input);
      if (currentAttempt !== attempt) return;
      setServerUrl(verified.serverUrl);
      pendingPassword = input.password;
      setCandidate(verified);
    } catch (cause) {
      if (currentAttempt !== attempt) return;
      setConnection({ status: "failed", message: connectionMessage(cause) });
    }
  };

  const connected = (server: VerifiedServer): void => {
    if (candidate() !== server) return;
    setConnection({ status: "connected" });
    setPassword("");
    const passwordToSave = pendingPassword;
    pendingPassword = "";
    void window.desktop.connection
      .save({ serverUrl: server.serverUrl, password: passwordToSave })
      .then(() => setSaved(true))
      .catch(() => setSaved(false));
  };

  const initialStreamFailed = (server: VerifiedServer, cause: unknown): void => {
    if (candidate() !== server) return;
    setCandidate(undefined);
    setConnection({ status: "failed", message: connectionMessage(cause) });
  };

  const changeServer = (): void => {
    attempt += 1;
    pendingPassword = "";
    setCandidate(undefined);
    setConnection({ status: "disconnected" });
  };

  const forget = async (): Promise<void> => {
    attempt += 1;
    pendingPassword = "";
    setCandidate(undefined);
    await window.desktop.connection.clear();
    setSaved(false);
    setServerUrl("");
    setPassword("");
    setConnection({ status: "disconnected" });
  };

  onMount(() => {
    void window.desktop.connection
      .load()
      .then((loaded) => {
        if (!loaded) return;
        setSaved(true);
        setServerUrl(loaded.serverUrl);
        if (loaded.password === undefined) return;
        setPassword(loaded.password);
        void connect();
      })
      .catch(() => {
        setConnection({
          status: "failed",
          message: "Saved connection settings could not be loaded. You can still connect manually.",
        });
      });
  });

  return (
    <>
      <Show when={candidate()} keyed>
        {(server) => (
          <div class="runtime-layer" hidden={connecting()}>
            <ServerProvider server={server}>
              <ConnectedApp
                server={server}
                onConnected={() => connected(server)}
                onInitialFailure={(cause) => initialStreamFailed(server, cause)}
                onChangeServer={changeServer}
              />
            </ServerProvider>
          </div>
        )}
      </Show>

      <Show when={!candidate() || connecting()}>
        <ConnectionForm
          serverUrl={serverUrl()}
          password={password()}
          busy={connecting()}
          error={connectionError()}
          hasSavedConnection={saved()}
          onServerUrlInput={setServerUrl}
          onPasswordInput={setPassword}
          onConnect={() => void connect()}
          onForget={() => void forget()}
        />
      </Show>
    </>
  );
}

type ConnectedAppProps = {
  readonly server: VerifiedServer;
  readonly onConnected: () => void;
  readonly onInitialFailure: (cause: unknown) => void;
  readonly onChangeServer: () => void;
};

function ConnectedApp(props: ConnectedAppProps) {
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
  const [createError, setCreateError] = createSignal<string>();
  const [submittingID, setSubmittingID] = createSignal<string>();
  const [promptError, setPromptError] = createSignal<string>();
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
      .sort((left, right) => right.time.updated - left.time.updated);
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
    return projectTranscript(
      runtime.data.session.message.list(id),
      runtime.data.session.status(id),
    );
  });

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
    void runtime
      .hydrateAfterReconnect(current)
      .then((next) => {
        if (!alive) return;
        setSelectedID(next);
        setTranscriptState(next ? { sessionID: next, status: "ready" } : { status: "idle" });
      })
      .catch(() => {
        if (!alive) return;
        setTranscriptState({
          sessionID: selectedID(),
          status: "failed",
          error: "The session could not be refreshed after reconnecting.",
        });
      })
      .finally(() => {
        reconnecting = false;
      });
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

  return (
    <main class="app-shell">
      <ConnectionBar
        serverUrl={props.server.serverUrl}
        status={streamConnected() ? "connected" : "reconnecting"}
        attempt={runtime.stream.attempt()}
        onChangeServer={props.onChangeServer}
      />

      <div class="workspace">
        <SessionSidebar
          sessions={sessions()}
          selectedID={selectedID()}
          loading={runtime.sessions.state() === "loading"}
          error={createError() ?? runtime.sessions.error()}
          canCreate={streamConnected() && runtime.sessions.state() === "ready"}
          creating={creating()}
          status={(sessionID) => runtime.data.session.status(sessionID)}
          onSelect={(sessionID) => {
            if (streamConnected()) selectSession(sessionID);
          }}
          onCreate={() => void createSession()}
          onRetry={() => {
            if (createError()) {
              void createSession();
            } else {
              void syncCatalog();
            }
          }}
        />

        <Show
          when={selectedSession()}
          fallback={
            <section class="empty-session">
              <h2>No session selected</h2>
              <p>Create a session in the server’s default directory to start a conversation.</p>
              <Button
                type="button"
                variant={creating() ? "loading" : "contrast"}
                disabled={!streamConnected() || creating()}
                onClick={() => void createSession()}
              >
                New Session
              </Button>
            </section>
          }
        >
          {(session) => (
            <section class="session-pane">
              <header class="session-heading">
                <h2>{session().title?.trim() || "Untitled session"}</h2>
              </header>
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
              <Composer
                value={drafts.get(session().id)}
                disabled={
                  !streamConnected() ||
                  transcriptLoading() ||
                  submittingID() !== undefined ||
                  running()
                }
                submitting={submittingID() === session().id}
                running={running()}
                error={promptError()}
                onInput={(value) => drafts.set(session().id, value)}
                onSubmit={() => void submitPrompt()}
              />
            </section>
          )}
        </Show>
      </div>
    </main>
  );
}

function connectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The OpenCode server connection could not be set up. Check the address and try again.";
}
