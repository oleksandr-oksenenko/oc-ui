import type { PermissionReply, PermissionRequest } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Card } from "@opencode-ai/ui/card";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createUniqueId, type JSX } from "solid-js";

import "./PermissionRequestCard.css";

export type PermissionRequestCardProps = {
  readonly request: PermissionRequest;
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly error?: string;
  readonly onReply: (reply: PermissionReply) => void;
};

/** Controlled presentation for one session permission request. */
export function PermissionRequestCard(props: PermissionRequestCardProps): JSX.Element {
  const titleID = createUniqueId();
  const unavailable = () => props.disabled === true || props.submitting === true;
  const savePatterns = () => {
    const patterns = props.request.save ?? [];
    return patterns.length > 0 && patterns.every((pattern) => pattern.length > 0) ? patterns : [];
  };

  return (
    <Card
      class="permission-request-card"
      data-permission-request-id={props.request.id}
      role="group"
      aria-labelledby={titleID}
      aria-busy={props.submitting === true}
      tabIndex={-1}
    >
      <header class="permission-request-header">
        <span class="permission-request-eyebrow">Permission required</span>
        <h2 id={titleID}>{props.request.action}</h2>
      </header>

      <Show when={props.request.message}>
        {(message) => <p class="permission-request-message">{message()}</p>}
      </Show>

      <section class="permission-request-section" aria-labelledby={`${titleID}-resources`}>
        <h3 id={`${titleID}-resources`}>Resources</h3>
        <ul
          class="permission-request-values"
          data-permission-resources
          aria-label="Requested resources"
          tabIndex={0}
        >
          <For each={props.request.resources}>
            {(resource) => (
              <li>
                <code>{resource}</code>
              </li>
            )}
          </For>
        </ul>
      </section>

      <Show when={props.request.source?.type === "tool" ? props.request.source.id : undefined}>
        {(toolCallID) => (
          <p class="permission-request-source">
            <span>Tool call</span>
            <code>{toolCallID()}</code>
          </p>
        )}
      </Show>

      <Show when={savePatterns().length > 0}>
        <section class="permission-request-section" aria-labelledby={`${titleID}-saved-patterns`}>
          <h3 id={`${titleID}-saved-patterns`}>Always allow patterns</h3>
          <ul
            class="permission-request-values"
            data-permission-save-patterns
            aria-label="Always allow patterns"
            tabIndex={0}
          >
            <For each={savePatterns()}>
              {(pattern) => (
                <li>
                  <code>{pattern}</code>
                </li>
              )}
            </For>
          </ul>
          <p class="permission-request-help">
            Always allow saves this action and these exact patterns for this project. It can also
            approve other matching pending requests.
          </p>
        </section>
      </Show>

      <Show when={props.error}>
        {(message) => (
          <p class="permission-request-error" role="alert">
            {message()}
          </p>
        )}
      </Show>

      <Show when={props.submitting}>
        <output class="permission-request-status" aria-live="polite">
          <Loader width={14} height={14} aria-hidden="true" /> Sending your reply…
        </output>
      </Show>

      <footer class="permission-request-footer">
        <p class="permission-request-reject-help">
          Reject all rejects this request and other pending requests in this session.
        </p>
        <div class="permission-request-actions">
          <Button
            type="button"
            size="small"
            variant="danger"
            disabled={unavailable()}
            onClick={() => props.onReply("reject")}
          >
            Reject all
          </Button>
          <Button
            type="button"
            size="small"
            variant="contrast"
            disabled={unavailable()}
            onClick={() => props.onReply("once")}
          >
            Allow once
          </Button>
          <Show when={savePatterns().length > 0}>
            <Button
              type="button"
              size="small"
              variant="outline"
              disabled={unavailable()}
              onClick={() => props.onReply("always")}
            >
              Always allow
            </Button>
          </Show>
        </div>
      </footer>
    </Card>
  );
}
