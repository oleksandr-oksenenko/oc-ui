import { Show } from "solid-js";
import { useAtomValue } from "@effect/atom-solid";
import { Toast } from "@opencode-ai/ui/toast";

import type { Renderer } from "./connection.ts";
import { ConnectionForm } from "./components/App/ConnectionForm.tsx";
import { ConnectedApp } from "./components/App/ConnectedApp.tsx";
import { ServerProvider } from "./opencode/index.ts";
import { ServerFlowDialogProvider } from "./ui/ServerFlowDialogProvider.tsx";

/** Views subscribe to Connection; the window owns its work and workspace. */
export function App(props: { readonly renderer: Renderer }) {
  const connection = props.renderer.connection;
  const state = useAtomValue(() => connection.state);
  const connecting = () => state().status === "connecting";
  const visibleWorkspace = () =>
    connecting() || state().status === "connected" ? state().workspace : undefined;
  const error = () =>
    state().error ??
    (state().mode === "local" && state().localUnavailable
      ? "The built-in OpenCode server stopped. Restart it, or connect to a remote server."
      : undefined);
  return (
    <ServerFlowDialogProvider>
      <Toast.Region style={{ "z-index": 40 }} />
      <Show when={visibleWorkspace()} keyed>
        {(workspace) => (
          <div class="runtime-layer" hidden={connecting()}>
            <ServerProvider runtime={workspace.runtime}>
              <ConnectedApp
                server={workspace.server}
                model={workspace.model}
                onChangeServer={connection.changeServer}
              />
            </ServerProvider>
          </div>
        )}
      </Show>
      <Show when={!visibleWorkspace() || connecting()}>
        <ConnectionForm
          serverUrl={state().serverUrl}
          password={state().password}
          mode={state().mode}
          busy={connecting()}
          error={error()}
          restartBuiltIn={state().localUnavailable}
          savedTarget={state().savedTarget}
          onModeChange={connection.setMode}
          onServerUrlInput={connection.setServerUrl}
          onPasswordInput={connection.setPassword}
          onConnect={() => connection.connect("remote")}
          onUseBuiltInServer={() => connection.connect("local")}
          onForget={connection.forget}
        />
      </Show>
    </ServerFlowDialogProvider>
  );
}
