import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode-ai/ui/dialog";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createEffect, createSignal, on } from "solid-js";

import type { WorkspaceOwner } from "../../../../../../workspace-owner.ts";
import { ServerDirectoryBrowser } from "../../../../../../ui/ServerDirectoryBrowser.tsx";
import "./ServerFlowDialog.css";

export type AddProjectDialogError =
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "add-project"; readonly message: string };

export type AddProjectDialogProps = {
  readonly effects: WorkspaceOwner;
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly initialLocation: LocationRef;
  readonly error?: AddProjectDialogError;
  readonly adding?: boolean;
  readonly onDismissBlockedChange?: (blocked: boolean) => void;
  readonly onAddProject: (location: LocationRef) => void;
};

export function AddProjectDialog(props: AddProjectDialogProps) {
  const dialog = useDialog();
  let directoryBrowser: HTMLElement | undefined;
  let operationError: HTMLElement | undefined;
  let mutationStatus: HTMLOutputElement | undefined;
  const [submitted, setSubmitted] = createSignal(false);
  const [location, setLocation] = createSignal<LocationRef>();
  const [browserLoading, setBrowserLoading] = createSignal(true);

  const busy = () => props.adding === true;
  const blocked = () => busy() || submitted();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const selected = location();
    if (busy() || browserLoading() || submitted() || selected === undefined) return;
    setSubmitted(true);
    props.onAddProject(selected);
  };

  createEffect(() => {
    const error = props.error;
    const adding = props.adding;
    queueMicrotask(() => {
      if (adding) mutationStatus?.focus();
      else if (error?.kind === "add-project") operationError?.focus();
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
        setSubmitted(false);
      },
      { defer: true },
    ),
  );

  createEffect(() => props.onDismissBlockedChange?.(blocked()));

  return (
    <Dialog size="large" containerClass="server-flow-dialog server-flow-dialog-add-project">
      <form
        class="server-flow-dialog-content"
        aria-busy={busy() ? "true" : undefined}
        onSubmit={submit}
      >
        <DialogHeader closeLabel="Close add project dialog" hideClose={blocked()}>
          <DialogTitleGroup
            title="Add project"
            description="Choose one project directory on the connected OpenCode server."
          />
        </DialogHeader>

        <DialogBody class="server-flow-dialog-body">
          <ServerDirectoryBrowser
            effects={props.effects}
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
            <output
              ref={(element) => {
                mutationStatus = element;
              }}
              class="server-flow-mutation-status"
              aria-live="polite"
              tabIndex={-1}
            >
              <Loader width={18} height={18} />
              <span>Adding project</span>
            </output>
          </Show>
        </DialogBody>

        <DialogFooter>
          <Show when={!blocked()}>
            <Button type="button" size="normal" variant="outline" onClick={() => dialog.close()}>
              Cancel
            </Button>
          </Show>
          <Button
            type="submit"
            size="normal"
            variant={
              busy() ? "loading" : props.error?.kind === "add-project" ? "outline" : "contrast"
            }
            disabled={blocked() || browserLoading() || location() === undefined}
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
        </DialogFooter>
      </form>
    </Dialog>
  );
}
