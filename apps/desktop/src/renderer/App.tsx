import { Show, createSignal, onMount } from "solid-js";

import { ConnectionForm } from "./components/App/ConnectionForm.tsx";
import { ConnectedApp } from "./components/App/ConnectedApp.tsx";
import { OpenCodeConnectionError, ServerProvider, verifyServer } from "./opencode/index.ts";
import type { VerifiedServer } from "./opencode/index.ts";

type ConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly status: "failed"; readonly message: string };

/** Owns only saved-connection setup and the connected/disconnected boundary. */
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
    void (async () => {
      try {
        const loaded = await window.desktop.connection.load();
        if (!loaded) return;
        setSaved(true);
        setServerUrl(loaded.serverUrl);
        if (loaded.password === undefined) return;
        setPassword(loaded.password);
        void connect();
      } catch {
        setConnection({
          status: "failed",
          message: "Saved connection settings could not be loaded. You can still connect manually.",
        });
      }
    })();
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

function connectionMessage(cause: unknown): string {
  if (cause instanceof OpenCodeConnectionError) return cause.message;
  return "The OpenCode server connection could not be set up. Check the address and try again.";
}
