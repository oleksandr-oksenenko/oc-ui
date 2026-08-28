import { Show, createSignal, onCleanup, onMount } from "solid-js";

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

/** Owns saved-target setup and the connected/disconnected boundary. */
export function App() {
  const desktop = window.desktop;
  const [serverUrl, setServerUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [saved, setSaved] = createSignal(false);
  const [owner, setOwner] = createSignal<ConnectionOwner>("none");
  const [candidate, setCandidate] = createSignal<VerifiedServer>();
  const [connection, setConnection] = createSignal<ConnectionState>({ status: "disconnected" });
  let attempt = 0;
  let pendingPassword = "";
  let savedRemotePassword = "";

  const connecting = () => connection().status === "connecting";
  const connectionError = () => {
    const state = connection();
    return state.status === "failed" ? state.message : undefined;
  };

  const disconnectLocal = async (): Promise<void> => {
    if (owner() !== "local") return;
    await desktop.localOpenCode.disconnect();
    if (owner() === "local") setOwner("none");
  };

  const connectRemote = async (
    input = { serverUrl: serverUrl(), password: password() || savedRemotePassword },
  ): Promise<void> => {
    const currentAttempt = ++attempt;
    if (owner() === "local") {
      setConnection({ status: "connecting" });
      try {
        await disconnectLocal();
      } catch {
        if (currentAttempt !== attempt) return;
        setConnection({ status: "failed", message: localCleanupMessage() });
        return;
      }
      if (currentAttempt !== attempt) return;
    }
    setOwner("remote");
    setConnection({ status: "connecting" });
    try {
      const verified = await verifyServer(input);
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
    const currentAttempt = ++attempt;
    setOwner("local");
    setCandidate(undefined);
    setConnection({ status: "connecting" });
    try {
      const local = await desktop.localOpenCode.connect();
      if (currentAttempt !== attempt) return;
      if (local.status === "failed") {
        setConnection({ status: "failed", message: local.message });
        try {
          await disconnectLocal();
        } catch {
          if (currentAttempt !== attempt) return;
          setConnection({ status: "failed", message: localCleanupMessage() });
        }
        return;
      }
      const verified = await verifyServer({
        serverUrl: local.connection.serverUrl,
        password: local.connection.password,
      });
      if (currentAttempt !== attempt) return;
      setServerUrl(verified.serverUrl);
      // This password belongs only to the running local process. It is never
      // passed to target.saveLocal or target.saveRemote.
      pendingPassword = local.connection.password;
      setCandidate(verified);
    } catch (cause) {
      if (currentAttempt !== attempt) return;
      try {
        await disconnectLocal();
        if (currentAttempt !== attempt) return;
        setConnection({ status: "failed", message: localConnectionMessage(cause) });
      } catch {
        if (currentAttempt !== attempt) return;
        setConnection({ status: "failed", message: localCleanupMessage() });
      }
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
      void desktop.target
        .saveLocal()
        .then(() => setSaved(true))
        .catch(() => setSaved(false));
      return;
    }

    if (connectionOwner !== "remote") return;
    void desktop.target
      .saveRemote({ serverUrl: server.serverUrl, password: passwordToSave })
      .then(() => setSaved(true))
      .catch(() => setSaved(false));
  };

  const initialStreamFailed = (server: VerifiedServer, cause: unknown): void => {
    if (candidate() !== server) return;
    const currentAttempt = ++attempt;
    setCandidate(undefined);
    if (owner() !== "local") {
      setOwner("none");
      setConnection({ status: "failed", message: connectionMessage(cause) });
      return;
    }
    setConnection({ status: "connecting" });
    void disconnectLocal().then(
      () => {
        if (currentAttempt !== attempt) return undefined;
        setConnection({ status: "failed", message: connectionMessage(cause) });
        return undefined;
      },
      () => {
        if (currentAttempt !== attempt) return undefined;
        setConnection({ status: "failed", message: localCleanupMessage() });
        return undefined;
      },
    );
  };

  const changeServer = async (): Promise<void> => {
    const currentAttempt = ++attempt;
    pendingPassword = "";
    setCandidate(undefined);
    setServerUrl("");
    setPassword("");
    savedRemotePassword = "";
    if (owner() === "local") {
      setConnection({ status: "connecting" });
      try {
        await disconnectLocal();
      } catch {
        if (currentAttempt !== attempt) return;
        setConnection({ status: "failed", message: localCleanupMessage() });
        return;
      }
      if (currentAttempt !== attempt) return;
    }
    setOwner("none");
    setConnection({ status: "disconnected" });
  };

  const forget = async (): Promise<void> => {
    attempt += 1;
    pendingPassword = "";
    savedRemotePassword = "";
    setCandidate(undefined);
    if (owner() === "local") {
      try {
        await disconnectLocal();
      } catch {
        setConnection({ status: "failed", message: localCleanupMessage() });
        return;
      }
    }
    setOwner("none");
    try {
      await desktop.target.clear();
    } catch {
      setConnection({
        status: "failed",
        message: "The saved connection could not be forgotten. Retry before continuing.",
      });
      return;
    }
    setSaved(false);
    setServerUrl("");
    setPassword("");
    setConnection({ status: "disconnected" });
  };

  onMount(() => {
    const unsubscribe = desktop.localOpenCode.onUnavailable(() => {
      if (owner() !== "local") return;
      const currentAttempt = ++attempt;
      pendingPassword = "";
      setCandidate(undefined);
      setConnection({ status: "connecting" });
      void disconnectLocal().then(
        () => {
          if (currentAttempt !== attempt) return undefined;
          setConnection({
            status: "failed",
            message:
              "The built-in OpenCode server stopped. Retry to start it again, or connect to a remote server.",
          });
          return undefined;
        },
        () => {
          if (currentAttempt !== attempt) return undefined;
          setConnection({ status: "failed", message: localCleanupMessage() });
          return undefined;
        },
      );
    });
    onCleanup(() => unsubscribe?.());

    void (async () => {
      const loadAttempt = attempt;
      try {
        const loaded = await desktop.target.load();
        if (loadAttempt !== attempt) return;
        if (loaded === undefined || loaded.kind === "local") {
          if (loaded?.kind === "local") setSaved(true);
          await connectLocal();
          return;
        }

        setSaved(true);
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
      <Show when={candidate()} keyed>
        {(server) => (
          <div class="runtime-layer" hidden={connecting()}>
            <ServerProvider server={server}>
              <ConnectedApp
                server={server}
                onConnected={() => connected(server)}
                onInitialFailure={(cause) => initialStreamFailed(server, cause)}
                onChangeServer={() => void changeServer()}
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

function connectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The OpenCode server connection could not be set up. Check the address and try again.";
}

function localConnectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The built-in OpenCode server is unavailable. Retry to start it again, or connect to a remote server.";
}

function localCleanupMessage(): string {
  return "The built-in OpenCode server could not be stopped. Retry before connecting to another server.";
}
