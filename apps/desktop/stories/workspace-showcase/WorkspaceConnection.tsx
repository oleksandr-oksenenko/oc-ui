import { createSignal } from "solid-js";
import { ConnectionForm } from "../../src/renderer/components/App/ConnectionForm.tsx";

/** Controlled connection UI; this preview never contacts the entered server. */
export function WorkspaceConnection(props: { readonly onConnect: (name: string) => void }) {
  const [mode, setMode] = createSignal<"local" | "remote">("local");
  const [url, setUrl] = createSignal("http://localhost:4096");
  const [password, setPassword] = createSignal("");
  return (
    <ConnectionForm
      mode={mode()}
      serverUrl={url()}
      password={password()}
      busy={false}
      onModeChange={setMode}
      onServerUrlInput={setUrl}
      onPasswordInput={setPassword}
      onConnect={() => props.onConnect(url())}
      onUseBuiltInServer={() => props.onConnect("Local server")}
      onForget={() => setUrl("")}
    />
  );
}
