import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect, createSignal, on } from "solid-js";

import { ServerDirectoryBrowser } from "../../../../../../../ui/ServerDirectoryBrowser.tsx";
import { createServerFlowDialog } from "./createServerFlowDialog.ts";
import "./ServerFlowDialog.css";

export type AddProjectDialogError =
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "add-project"; readonly message: string };

export type AddProjectDialogProps = {
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly initialLocation: LocationRef;
  readonly error?: AddProjectDialogError;
  readonly adding?: boolean;
  readonly onDismiss: () => void;
  readonly onAddProject: (location: LocationRef) => void;
};

export function AddProjectDialog(props: AddProjectDialogProps) {
  let directoryBrowser: HTMLElement | undefined;
  let operationError: HTMLElement | undefined;
  let submitted = false;
  const [location, setLocation] = createSignal<LocationRef>();
  const [browserLoading, setBrowserLoading] = createSignal(true);

  const busy = () => props.adding === true;
  const { ref: dialogRef, dismiss } = createServerFlowDialog({
    blocked: () => busy() || submitted,
    onDismiss: props.onDismiss,
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const selected = location();
    if (busy() || browserLoading() || submitted || selected === undefined) return;
    submitted = true;
    props.onAddProject(selected);
  };

  createEffect(() => {
    const error = props.error;
    queueMicrotask(() => {
      if (error?.kind === "add-project") operationError?.focus();
      else {
        const target =
          directoryBrowser?.querySelector<HTMLElement>("button:not([disabled])") ??
          directoryBrowser;
        target?.focus();
      }
    });
  });

  createEffect(
    on(
      () => [props.error, props.adding] as const,
      () => {
        submitted = false;
      },
      { defer: true },
    ),
  );

  return (
    <dialog
      ref={dialogRef}
      class="server-flow-dialog server-flow-dialog-add-project"
      aria-labelledby="add-project-dialog-title"
      aria-describedby="add-project-dialog-description"
      aria-busy={busy() ? "true" : undefined}
    >
      <form class="server-flow-dialog-content" onSubmit={submit}>
        <header class="server-flow-dialog-header">
          <div>
            <h2 id="add-project-dialog-title">Add project</h2>
            <p id="add-project-dialog-description">
              Choose one project directory on the connected OpenCode server.
            </p>
          </div>
          <Show when={!busy()}>
            <Button
              type="button"
              size="small"
              variant="ghost-muted"
              icon="xmark-small"
              aria-label="Close add project dialog"
              onClick={dismiss}
            />
          </Show>
        </header>

        <div class="server-flow-dialog-body">
          <ServerDirectoryBrowser
            listDirectory={props.listDirectory}
            label="Project directory"
            initialLocation={props.initialLocation}
            disabled={props.adding === true}
            validationError={props.error?.kind === "validation" ? props.error.message : undefined}
            onBrowserReady={(element) => {
              directoryBrowser = element;
            }}
            onLoadingChange={setBrowserLoading}
            onDirectoryChange={(next) => {
              setLocation(next);
            }}
          />

          <Show when={props.error?.kind === "add-project"}>
            <section
              ref={(element: HTMLElement) => {
                operationError = element;
              }}
              class="server-flow-operation-error"
              role="alert"
              tabIndex={-1}
            >
              <Icon name="warning" />
              <div>
                <strong>Project could not be added</strong>
                <p>{props.error?.message}</p>
              </div>
            </section>
          </Show>

          <Show when={busy()}>
            <output class="server-flow-mutation-status" aria-live="polite">
              <Loader width={18} height={18} />
              <span>Adding project</span>
            </output>
          </Show>
        </div>

        <footer class="server-flow-dialog-footer">
          <Show when={!busy()}>
            <Button type="button" size="large" variant="ghost" onClick={dismiss}>
              Cancel
            </Button>
          </Show>
          <Button
            type="submit"
            size="large"
            variant={busy() ? "loading" : "contrast"}
            disabled={busy() || browserLoading() || location() === undefined}
          >
            <Show when={busy()}>
              <Loader width={16} height={16} />
            </Show>
            {busy()
              ? "Adding project"
              : props.error?.kind === "add-project"
                ? "Try again"
                : "Add project"}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
