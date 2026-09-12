import { useAtomValue } from "@effect/atom-solid";
import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { For, Show, createEffect, createMemo, createUniqueId, onCleanup } from "solid-js";

import type { WorkspaceOwner } from "../workspace-owner.ts";

import "./ServerDirectoryBrowser.css";
import { serverPathChild, serverPathParent } from "./serverPath.ts";

export type ServerDirectoryBrowserProps = {
  readonly effects: WorkspaceOwner;
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly label: string;
  readonly initialLocation: LocationRef;
  readonly disabled?: boolean;
  readonly validationError?: string;
  readonly onBrowserReady?: (element: HTMLElement) => void;
  readonly onLoadingChange?: (loading: boolean) => void;
  readonly onDirectoryChange: (location: LocationRef) => void;
};

type DirectoryState = {
  readonly location: LocationRef;
  readonly requestedLocation: LocationRef;
  readonly directories: readonly string[];
  readonly loading: boolean;
  readonly error?: string;
};

export function ServerDirectoryBrowser(props: ServerDirectoryBrowserProps) {
  const validationErrorId = createUniqueId();
  const initialLocation = createMemo(() => props.initialLocation);
  const { effects } = props;
  const state = Atom.make<DirectoryState>({
    location: props.initialLocation,
    requestedLocation: props.initialLocation,
    directories: [],
    loading: true,
  });
  onCleanup(effects.registry.mount(state));
  const snapshot = useAtomValue(() => state);
  const location = () => snapshot().location;
  const directories = () => snapshot().directories;
  const loading = () => snapshot().loading;
  const error = () => snapshot().error;
  let browserElement: HTMLElement | undefined;
  let entriesList: HTMLUListElement | undefined;
  let hasResolvedDirectory = false;
  const request = effects.latest();
  onCleanup(request.cancel);

  const focusStableControl = (): void => {
    queueMicrotask(() => {
      const target =
        browserElement?.querySelector<HTMLElement>("button:not([disabled])") ?? browserElement;
      target?.focus();
    });
  };

  const readDirectory = Effect.fn("ServerDirectoryBrowser.readDirectory")(
    function* (requestedLocation: LocationRef) {
      effects.registry.update(state, (current) => ({
        ...current,
        requestedLocation,
        loading: true,
        error: undefined,
      }));
      props.onLoadingChange?.(true);
      const response = yield* effects.request((signal) =>
        props.listDirectory(
          {
            location:
              requestedLocation.workspaceID === undefined
                ? { directory: requestedLocation.directory }
                : {
                    directory: requestedLocation.directory,
                    workspace: requestedLocation.workspaceID,
                  },
            path: ".",
          },
          { signal },
        ),
      );
      const workspaceID = response.location.workspaceID;
      const resolvedLocation: LocationRef =
        workspaceID === undefined
          ? { directory: response.location.directory }
          : { directory: response.location.directory, workspaceID };
      effects.registry.set(state, {
        location: resolvedLocation,
        requestedLocation,
        directories: response.data
          .filter((entry) => entry.type === "directory")
          .map((entry) => entry.path),
        loading: false,
      });
      props.onLoadingChange?.(false);
      if (entriesList) entriesList.scrollTop = 0;
      props.onDirectoryChange(resolvedLocation);
      if (hasResolvedDirectory || browserElement?.contains(document.activeElement)) {
        focusStableControl();
      }
      hasResolvedDirectory = true;
    },
    Effect.catchTag("WorkspaceRequestError", ({ cause }) =>
      Effect.sync(() => {
        effects.registry.update(state, (current) => ({
          ...current,
          loading: false,
          error: errorMessage(cause),
        }));
        props.onLoadingChange?.(false);
        focusStableControl();
      }),
    ),
  );

  const loadDirectory = (requestedLocation: LocationRef): void => {
    request.run(readDirectory(requestedLocation));
  };

  createEffect(() => {
    loadDirectory(initialLocation());
  });

  const navigationDisabled = () => props.disabled === true || loading();
  const parentDirectory = () => serverPathParent(location().directory);

  return (
    <section class="server-directory-browser-shell" aria-label={props.label}>
      <Show when={props.validationError}>
        {(validationError) => (
          <p id={validationErrorId} class="server-directory-error" role="alert">
            {validationError()}
          </p>
        )}
      </Show>

      <div
        ref={(element: HTMLDivElement) => {
          browserElement = element;
          props.onBrowserReady?.(element);
        }}
        class="server-directory-browser"
        tabIndex={-1}
        aria-busy={loading() ? "true" : undefined}
        aria-describedby={props.validationError ? validationErrorId : undefined}
        aria-invalid={props.validationError ? "true" : undefined}
      >
        <header class="server-directory-browser-header">
          <span class="server-directory-browser-path">{location().directory}</span>
        </header>

        <Show when={loading()}>
          <output class="server-directory-state" aria-live="polite">
            <Loader width={16} height={16} />
            <span>Loading server directories</span>
          </output>
        </Show>

        <Show when={!loading() && error()}>
          {(listingError) => (
            <div class="server-directory-state server-directory-listing-error" role="alert">
              {listingError()}
              <Button
                type="button"
                size="normal"
                variant="outline"
                disabled={navigationDisabled()}
                onClick={() => loadDirectory(snapshot().requestedLocation)}
              >
                Retry
              </Button>
            </div>
          )}
        </Show>

        <Show when={!error()}>
          <ul
            ref={(element: HTMLUListElement) => {
              entriesList = element;
            }}
            class="server-directory-entries oc-scrollable"
            aria-label="Directories"
          >
            <li>
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                disabled={navigationDisabled() || parentDirectory() === location().directory}
                aria-describedby={props.validationError ? validationErrorId : undefined}
                aria-label="Go to parent directory"
                onClick={() => loadDirectory({ ...location(), directory: parentDirectory() })}
              >
                <Icon name="folder" />
                <span>..</span>
              </Button>
            </li>
            <For each={directories()}>
              {(directoryName) => (
                <li>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    disabled={navigationDisabled()}
                    aria-describedby={props.validationError ? validationErrorId : undefined}
                    aria-label={`Browse directory ${directoryName}`}
                    onClick={() =>
                      loadDirectory({
                        ...location(),
                        directory: serverPathChild(location().directory, directoryName),
                      })
                    }
                  >
                    <Icon name="folder" />
                    <span
                      class="server-directory-entry-name"
                      classList={{
                        "server-directory-entry-name-hidden": directoryName.startsWith("."),
                      }}
                    >
                      {directoryName}
                    </span>
                    <Icon
                      class="server-directory-entry-chevron"
                      name="chevron-right"
                      size="small"
                    />
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={!loading() && !error() && directories().length === 0}>
          <p class="server-directory-state">No child directories.</p>
        </Show>
      </div>
    </section>
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message;
  return "The server directory could not be loaded.";
}
