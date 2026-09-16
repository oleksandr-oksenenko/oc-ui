import { Button } from "@opencode/ui/button";
import { Field } from "@opencode/ui/field";
import { Loader } from "@opencode/ui/loader";
import { RadioGroup, RadioItem } from "@opencode/ui/radio";
import { TextInput } from "@opencode/ui/text-input";
import { Show } from "solid-js";
import { ThemeToggle } from "../../ui/ThemeToggle.tsx";

import "./ConnectionForm.css";

export type ConnectionFormProps = {
  readonly builtInAvailable?: boolean;
  readonly mode: "local" | "remote";
  readonly serverUrl: string;
  readonly password: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly restartBuiltIn?: boolean;
  readonly savedTarget?:
    | { readonly kind: "local" }
    | { readonly kind: "remote"; readonly serverUrl: string };
  readonly onModeChange: (mode: "local" | "remote") => void;
  readonly onServerUrlInput: (value: string) => void;
  readonly onPasswordInput: (value: string) => void;
  readonly onConnect: () => void;
  readonly onUseBuiltInServer: () => void;
  readonly onForget: () => void;
};

function isNonLoopbackHttp(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    return (
      url.hostname !== "localhost" &&
      url.hostname !== "::1" &&
      url.hostname !== "[::1]" &&
      !url.hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

function savedTargetLabel(target: NonNullable<ConnectionFormProps["savedTarget"]>): string {
  return target.kind === "local" ? "Built-in server" : target.serverUrl;
}

export function ConnectionForm(props: ConnectionFormProps) {
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!props.busy) props.onConnect();
  };

  return (
    <main class="connection-form-page">
      <section class="connection-form-column" aria-labelledby="connection-form-title">
        <ThemeToggle />
        <header class="connection-form-heading">
          <p class="connection-form-eyebrow">Ocui</p>
          <h1 id="connection-form-title">Connect to OpenCode</h1>
          <p>
            {props.builtInAvailable === false
              ? "Connect to your OpenCode server. This browser remembers the address; passwords stay on this page."
              : "Choose where this app should run and remember that choice for next time."}
          </p>
        </header>

        <Show when={props.savedTarget}>
          {(saved) => (
            <div class="connection-form-saved" role="status">
              <span>Saved choice</span>
              <strong>{savedTargetLabel(saved())}</strong>
            </div>
          )}
        </Show>

        <Show when={props.builtInAvailable !== false}>
          <RadioGroup
            class="connection-form-mode"
            label="Connection"
            value={props.mode}
            disabled={props.busy}
            onChange={(value) => {
              if (value === "local" || value === "remote") props.onModeChange(value);
            }}
          >
            <RadioItem
              value="local"
              label="Built-in"
              description="Start a private OpenCode server managed by this app."
            />
            <RadioItem
              value="remote"
              label="Remote"
              description="Connect to an OpenCode server running elsewhere."
            />
          </RadioGroup>
        </Show>

        <form class="connection-form-fields" aria-busy={props.busy} onSubmit={submit}>
          <Show when={props.mode === "remote"}>
            <Field class="connection-form-field" invalid={props.error !== undefined}>
              <Field.Label>Server URL</Field.Label>
              <Field.Control>
                <TextInput
                  class="connection-form-input"
                  appearance="large"
                  autocomplete="url"
                  disabled={props.busy}
                  invalid={props.error !== undefined}
                  placeholder={
                    props.builtInAvailable === false
                      ? "https://opencode.example.com"
                      : "http://homie:4096"
                  }
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
                  placeholder="Optional server password"
                  type="password"
                  value={props.password}
                  onInput={(event) => props.onPasswordInput(event.currentTarget.value)}
                />
              </Field.Control>
            </Field>
          </Show>

          <Show when={props.error}>
            {(error) => (
              <p class="connection-form-error" role="alert">
                {error()}
              </p>
            )}
          </Show>

          <Show when={props.busy}>
            <output class="connection-form-status" aria-live="polite">
              <Loader width={14} height={14} />
              <span>{props.mode === "local" ? "Starting built-in server" : "Connecting"}</span>
            </output>
          </Show>

          <div class="connection-form-actions">
            <Button
              class="connection-form-submit"
              type={props.mode === "remote" ? "submit" : "button"}
              size="normal"
              variant={props.busy ? "loading" : props.error ? "outline" : "contrast"}
              disabled={props.busy}
              onClick={props.mode === "local" ? props.onUseBuiltInServer : undefined}
            >
              {props.busy
                ? props.mode === "local"
                  ? "Starting"
                  : "Connecting"
                : props.mode === "local" && props.restartBuiltIn
                  ? "Restart"
                  : props.error
                    ? "Retry"
                    : props.mode === "local"
                      ? "Start built-in server"
                      : props.builtInAvailable === false
                        ? "Connect"
                        : "Connect to remote"}
            </Button>
            <Show when={props.savedTarget}>
              <Button
                type="button"
                size="normal"
                variant="outline"
                disabled={props.busy}
                onClick={props.onForget}
              >
                Forget saved choice
              </Button>
            </Show>
          </div>
        </form>
      </section>
    </main>
  );
}
