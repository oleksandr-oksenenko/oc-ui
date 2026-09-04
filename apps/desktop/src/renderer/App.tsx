import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Toast } from "@opencode-ai/ui/toast";

import type { OpenCodeTarget } from "../shared/desktop-api.ts";
import { ConnectionForm } from "./components/App/ConnectionForm.tsx";
import { ConnectedApp } from "./components/App/ConnectedApp.tsx";
import { OpenCodeConnectionError, ServerProvider, verifyServer } from "./opencode/index.ts";
import type { VerifiedServer } from "./opencode/index.ts";
import { ServerFlowDialogProvider } from "./ui/ServerFlowDialogProvider.tsx";

type ConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly status: "failed"; readonly message: string };

type ConnectionOwner = "none" | "local" | "remote";
type ConnectionMode = Exclude<ConnectionOwner, "none">;
type SavedTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly serverUrl: string };

/** Owns saved-target setup and the connected/disconnected boundary. */
export function App() {
  const desktop = window.desktop;
  const [serverUrl, setServerUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [mode, setMode] = createSignal<ConnectionMode>("local");
  const [savedTarget, setSavedTarget] = createSignal<SavedTarget>();
  const [owner, setOwner] = createSignal<ConnectionOwner>("none");
  const [candidate, setCandidate] = createSignal<VerifiedServer>();
  const [connection, setConnection] = createSignal<ConnectionState>({ status: "disconnected" });
  const [localUnavailable, setLocalUnavailable] = createSignal(false);
  let attempt = 0;
  let attemptAbort: AbortController | undefined;
  let pendingPassword = "";
  let savedRemotePassword = "";

  const connecting = () => connection().status === "connecting";
  const connectionError = () => {
    const state = connection();
    if (state.status === "failed") return state.message;
    return mode() === "local" && localUnavailable()
      ? "The built-in OpenCode server stopped. Restart it, or connect to a remote server."
      : undefined;
  };

  const invalidateAttempt = (): number => {
    attemptAbort?.abort();
    attemptAbort = undefined;
    attempt += 1;
    return attempt;
  };
  onCleanup(() => {
    invalidateAttempt();
    pendingPassword = "";
    savedRemotePassword = "";
  });

  const connectRemote = async (
    input = { serverUrl: serverUrl(), password: password() || savedRemotePassword },
  ): Promise<void> => {
    const currentAttempt = invalidateAttempt();
    attemptAbort = new AbortController();
    const signal = attemptAbort.signal;
    setOwner("remote");
    setMode("remote");
    setCandidate(undefined);
    setConnection({ status: "connecting" });
    try {
      const verified = await verifyServer(input, signal);
      if (currentAttempt !== attempt) return;
      setServerUrl(verified.serverUrl);
      pendingPassword = input.password;
      setCandidate(verified);
    } catch (cause) {
      if (currentAttempt !== attempt) return;
      setOwner("none");
      setConnection({ status: "failed", message: connectionMessage(cause) });
    }
  };

  const connectLocal = async (): Promise<void> => {
    const currentAttempt = invalidateAttempt();
    attemptAbort = new AbortController();
    const signal = attemptAbort.signal;
    setOwner("local");
    setMode("local");
    setLocalUnavailable(false);
    setCandidate(undefined);
    setConnection({ status: "connecting" });
    try {
      const local = await desktop.localOpenCode.connect();
      if (currentAttempt !== attempt) return;
      if (local.status === "failed") {
        setConnection({ status: "failed", message: local.message });
        return;
      }
      const verified = await verifyServer(local.connection, signal);
      if (currentAttempt !== attempt) return;
      setServerUrl(verified.serverUrl);
      // This password belongs only to the running local process. It is never
      // passed to target.saveLocal or target.saveRemote.
      pendingPassword = local.connection.password;
      setCandidate(verified);
    } catch (cause) {
      if (currentAttempt !== attempt) return;
      setConnection({ status: "failed", message: localConnectionMessage(cause) });
    }
  };

  const connected = (server: VerifiedServer): void => {
    if (candidate() !== server) return;
    const connectionOwner = owner();
    setConnection({ status: "connected" });
    setPassword("");
    const passwordToSave = pendingPassword;
    pendingPassword = "";

    if (connectionOwner === "local") {
      // Local authentication is process-scoped and intentionally ephemeral.
      const saveAttempt = attempt;
      void desktop.target
        .saveLocal()
        .then(() => {
          if (saveAttempt === attempt) setSavedTarget({ kind: "local" });
          return undefined;
        })
        .catch(() => undefined);
      return;
    }

    if (connectionOwner !== "remote") return;
    const saveAttempt = attempt;
    const remoteTarget =
      passwordToSave.length === 0
        ? { serverUrl: server.serverUrl }
        : { serverUrl: server.serverUrl, password: passwordToSave };
    void desktop.target
      .saveRemote(remoteTarget)
      .then(() => {
        if (saveAttempt === attempt) {
          setSavedTarget({ kind: "remote", serverUrl: server.serverUrl });
        }
        return undefined;
      })
      .catch(() => undefined);
  };

  const initialStreamFailed = (server: VerifiedServer, cause: unknown): void => {
    if (candidate() !== server) return;
    invalidateAttempt();
    setCandidate(undefined);
    setOwner("none");
    setConnection({ status: "failed", message: connectionMessage(cause) });
  };

  const changeServer = (): void => {
    invalidateAttempt();
    const previousOwner = owner();
    pendingPassword = "";
    setCandidate(undefined);
    setPassword("");
    savedRemotePassword = "";
    if (previousOwner === "remote") {
      setMode("remote");
    } else if (previousOwner === "local") {
      setMode("local");
      setServerUrl("");
    } else {
      restoreSavedTarget(savedTarget(), setMode, setServerUrl);
    }
    setOwner("none");
    setConnection({ status: "disconnected" });
  };

  const forget = async (): Promise<void> => {
    const currentAttempt = invalidateAttempt();
    pendingPassword = "";
    savedRemotePassword = "";
    setCandidate(undefined);
    setOwner("none");
    try {
      await desktop.target.clear();
      if (currentAttempt !== attempt) return;
    } catch {
      if (currentAttempt !== attempt) return;
      setConnection({
        status: "failed",
        message: "The saved connection could not be forgotten. Retry before continuing.",
      });
      return;
    }
    setSavedTarget(undefined);
    setMode("local");
    setServerUrl("");
    setPassword("");
    setConnection({ status: "disconnected" });
  };

  onMount(() => {
    const unsubscribe = desktop.localOpenCode.onUnavailable(() => {
      setLocalUnavailable(true);
      if (owner() !== "local") return;
      invalidateAttempt();
      pendingPassword = "";
      setCandidate(undefined);
      setOwner("none");
      setConnection({ status: "disconnected" });
    });
    onCleanup(unsubscribe);

    void (async () => {
      const loadAttempt = attempt;
      try {
        const loaded = await desktop.target.load();
        if (loadAttempt !== attempt) return;
        if (loaded === undefined) return;

        setSavedTarget(publicSavedTarget(loaded));
        setMode(loaded.kind);
        if (loaded.kind === "local") return;

        setServerUrl(loaded.serverUrl);
        if (loaded.password === undefined) return;
        savedRemotePassword = loaded.password;
        await connectRemote({ serverUrl: loaded.serverUrl, password: loaded.password });
      } catch {
        if (loadAttempt !== attempt) return;
        setConnection({
          status: "failed",
          message: "Saved connection settings could not be loaded. You can still connect manually.",
        });
      }
    })();
  });

  return (
    <ServerFlowDialogProvider>
      {/* OpenCode modal overlays start at 50; notifications must not intercept their actions. */}
      <Toast.Region style={{ "z-index": 40 }} />
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
          mode={mode()}
          busy={connecting()}
          error={connectionError()}
          restartBuiltIn={localUnavailable()}
          savedTarget={savedTarget()}
          onModeChange={(nextMode) => {
            invalidateAttempt();
            setOwner("none");
            setMode(nextMode);
            setConnection({ status: "disconnected" });
            if (nextMode === "remote" && serverUrl().length === 0) {
              const saved = savedTarget();
              if (saved?.kind === "remote") setServerUrl(saved.serverUrl);
            }
          }}
          onServerUrlInput={(value) => {
            savedRemotePassword = "";
            setServerUrl(value);
          }}
          onPasswordInput={setPassword}
          onConnect={() => void connectRemote()}
          onUseBuiltInServer={() => void connectLocal()}
          onForget={() => void forget()}
        />
      </Show>
    </ServerFlowDialogProvider>
  );
}

function publicSavedTarget(target: OpenCodeTarget): SavedTarget {
  return target.kind === "local" ? target : { kind: "remote", serverUrl: target.serverUrl };
}

function restoreSavedTarget(
  saved: SavedTarget | undefined,
  setMode: (mode: ConnectionMode) => void,
  setServerUrl: (serverUrl: string) => void,
): void {
  if (saved?.kind === "remote") {
    setMode("remote");
    setServerUrl(saved.serverUrl);
    return;
  }
  setMode("local");
  setServerUrl("");
}

function connectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The OpenCode server connection could not be set up. Check the address and try again.";
}

function localConnectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The built-in OpenCode server is unavailable. Retry to start it again, or connect to a remote server.";
}
