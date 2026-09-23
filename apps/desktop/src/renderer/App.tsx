import { createEffect, createMemo, onCleanup, Show, untrack } from "solid-js";
import { useAtomValue } from "@effect/atom-solid";
import { showToast, Toast, toaster } from "@opencode/ui/toast";

import type { Renderer } from "./connection.ts";
import { ConnectionForm } from "./components/App/ConnectionForm.tsx";
import { ConnectedApp } from "./components/App/ConnectedApp.tsx";
import { ServerProvider } from "./opencode/index.ts";
import { DiffHighlightProvider } from "./ui/DiffHighlightProvider.tsx";
import { ExternalLinkProvider } from "./ui/ExternalLinkProvider.tsx";
import { ServerFlowDialogProvider } from "./ui/ServerFlowDialogProvider.tsx";
import { ThemeProvider } from "./ui/ThemeProvider.tsx";

/** Views subscribe to Connection; the window owns its work and workspace. */
export function App(props: { readonly renderer: Renderer }) {
  const connection = props.renderer.connection;
  const state = useAtomValue(() => connection.state);
  const appearance = useAtomValue(() => props.renderer.appearance.state);
  const diffManager = useAtomValue(() => props.renderer.diffHighlight.state);
  // The highlight pool owns its own theme; keep it in step with the window theme.
  createEffect(() => props.renderer.diffHighlight.setTheme(appearance().theme));
  createEffect(() => {
    const description = appearance().notice;
    if (!description) return;
    const id = untrack(() => showToast({ title: "Appearance", description, persistent: true }));
    onCleanup(() => toaster.dismiss(id));
  });
  const notice = createMemo(() => state().notice);
  createEffect(() => {
    const description = notice();
    if (!description) return;
    const id = untrack(() =>
      showToast({ title: "Connection settings", description, persistent: true }),
    );
    onCleanup(() => toaster.dismiss(id));
  });
  const connecting = () => state().status === "connecting";
  const visibleWorkspace = () =>
    connecting() || state().status === "connected" ? state().workspace : undefined;
  const error = () =>
    state().error ??
    (state().mode === "local" && state().localUnavailable
      ? "The built-in OpenCode server stopped. Restart it, or connect to a remote server."
      : undefined);
  const openExternal = (url: string) => {
    void props.renderer.openExternal(url).catch(() => {
      // Do not log the URL; query strings can carry credentials.
      untrack(() =>
        showToast({
          title: "Open link",
          description:
            "This link could not be opened. Copy the address and open it in your browser.",
        }),
      );
    });
  };
  return (
    <ThemeProvider theme={() => appearance().theme} onChange={props.renderer.appearance.setTheme}>
      <ExternalLinkProvider open={openExternal}>
        <DiffHighlightProvider manager={diffManager}>
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
                builtInAvailable={connection.builtInAvailable}
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
        </DiffHighlightProvider>
      </ExternalLinkProvider>
    </ThemeProvider>
  );
}
