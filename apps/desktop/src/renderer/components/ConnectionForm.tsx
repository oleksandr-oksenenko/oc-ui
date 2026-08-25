import { Button } from "@opencode-ai/ui/button";
import { TextInput } from "@opencode-ai/ui/text-input";
import { Show } from "solid-js";

export type ConnectionFormProps = {
  readonly serverUrl: string;
  readonly password: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly hasSavedConnection: boolean;
  readonly onServerUrlInput: (value: string) => void;
  readonly onPasswordInput: (value: string) => void;
  readonly onConnect: () => void;
  readonly onForget: () => void;
};

function isNonLoopbackHttp(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    return (
      url.hostname !== "localhost" && url.hostname !== "::1" && !url.hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

export function ConnectionForm(props: ConnectionFormProps) {
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!props.busy) props.onConnect();
  };

  return (
    <main class="connection-page">
      <section class="connection-card" aria-labelledby="connection-title">
        <div class="connection-heading">
          <p class="eyebrow">OpenCode desktop</p>
          <h1 id="connection-title">Connect to a server</h1>
          <p>Use an existing OpenCode 2 server to browse sessions and send prompts.</p>
        </div>

        <form class="connection-form" onSubmit={submit}>
          <label class="field">
            <span>Server URL</span>
            <TextInput
              appearance="large"
              autocomplete="url"
              disabled={props.busy}
              invalid={props.error !== undefined}
              placeholder="http://homie:4096"
              spellcheck={false}
              value={props.serverUrl}
              onInput={(event) => props.onServerUrlInput(event.currentTarget.value)}
            />
          </label>

          <label class="field">
            <span>Password</span>
            <TextInput
              appearance="large"
              autocomplete="current-password"
              disabled={props.busy}
              invalid={props.error !== undefined}
              placeholder="OpenCode server password"
              type="password"
              value={props.password}
              onInput={(event) => props.onPasswordInput(event.currentTarget.value)}
            />
          </label>

          <Show when={isNonLoopbackHttp(props.serverUrl)}>
            <p class="connection-warning" role="note">
              Plain HTTP does not encrypt this password in transit. Connect only through a network
              or tunnel you trust.
            </p>
          </Show>

          <Show when={props.error}>
            {(error) => (
              <p class="operation-error" role="alert">
                {error()}
              </p>
            )}
          </Show>

          <div class="connection-actions">
            <Button
              type="submit"
              size="large"
              variant={props.busy ? "loading" : "contrast"}
              disabled={props.busy}
            >
              {props.busy ? "Connecting" : "Connect"}
            </Button>
            <Show when={props.hasSavedConnection}>
              <Button
                type="button"
                size="large"
                variant="ghost"
                disabled={props.busy}
                onClick={props.onForget}
              >
                Forget saved connection
              </Button>
            </Show>
          </div>
        </form>
      </section>
    </main>
  );
}
