import { Button } from "@opencode/ui/button";
import { Loader } from "@opencode/ui/loader";
import { Show } from "solid-js";

import "./BuiltInStartup.css";

export function BuiltInStartup(props: {
  readonly error?: string;
  readonly restart: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <main class="built-in-startup">
      <section class="built-in-startup-content" aria-label="OpenCode startup">
        <Show
          when={props.error}
          fallback={
            <output class="built-in-startup-status" aria-live="polite">
              <Loader width={32} height={32} />
              <span class="built-in-startup-copy">
                <span class="built-in-startup-title">Starting OpenCode…</span>
                <span class="built-in-startup-description">Preparing your workspace</span>
              </span>
            </output>
          }
        >
          {(error) => (
            <>
              <p class="built-in-startup-error" role="alert">
                {error()}
              </p>
              <Button size="normal" variant="contrast" onClick={props.onRetry}>
                {props.restart ? "Restart" : "Retry"}
              </Button>
            </>
          )}
        </Show>
      </section>
    </main>
  );
}
