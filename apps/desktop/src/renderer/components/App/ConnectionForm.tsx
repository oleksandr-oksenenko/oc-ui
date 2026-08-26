import { Button } from "@opencode-ai/ui/button";
import { Field } from "@opencode-ai/ui/field";
import { TextInput } from "@opencode-ai/ui/text-input";
import { Show } from "solid-js";

import "./ConnectionForm.css";

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
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "::1" &&
      url.hostname !== "[::1]" &&
      !url.hostname.startsWith("127.")
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
    <main class="connection-form-page">
      <section class="connection-form-column" aria-labelledby="connection-form-title">
        <header class="connection-form-heading">
          <p class="connection-form-eyebrow">OpenCode desktop</p>
          <h1 id="connection-form-title">Connect to a server</h1>
          <p>Use an existing OpenCode server to browse sessions and send prompts.</p>
        </header>

        <form class="connection-form-fields" onSubmit={submit}>
          <Field class="connection-form-field" invalid={props.error !== undefined}>
            <Field.Label>Server URL</Field.Label>
            <Field.Control>
              <TextInput
                class="connection-form-input"
                appearance="large"
                autocomplete="url"
                disabled={props.busy}
                invalid={props.error !== undefined}
                placeholder="http://homie:4096"
                spellcheck={false}
                value={props.serverUrl}
                onInput={(event) => props.onServerUrlInput(event.currentTarget.value)}
              />
            </Field.Control>
            <Show when={isNonLoopbackHttp(props.serverUrl)}>
              <Field.Suffix class="connection-form-warning" role="note">
                This is an HTTP connection to another device. Your password is not encrypted in
                transit.
              </Field.Suffix>
            </Show>
          </Field>

          <Field class="connection-form-field" invalid={props.error !== undefined}>
            <Field.Label>Password</Field.Label>
            <Field.Control>
              <TextInput
                class="connection-form-input"
                appearance="large"
                autocomplete="current-password"
                disabled={props.busy}
                invalid={props.error !== undefined}
                placeholder="OpenCode server password"
                type="password"
                value={props.password}
                onInput={(event) => props.onPasswordInput(event.currentTarget.value)}
              />
            </Field.Control>
            <Show when={props.error}>
              {(error) => (
                <Field.Suffix class="connection-form-error" role="alert">
                  {error()}
                </Field.Suffix>
              )}
            </Show>
          </Field>

          <div class="connection-form-actions">
            <Button
              class="connection-form-submit"
              type="submit"
              size="large"
              variant={props.busy ? "loading" : "contrast"}
              disabled={props.busy}
            >
              {props.busy ? "Connecting" : props.error ? "Retry" : "Connect"}
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
