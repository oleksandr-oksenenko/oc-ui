import { useAtomValue } from "@effect/atom-solid";
import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "./Loader.tsx";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { For, Show, createEffect, createMemo, createUniqueId, onCleanup } from "solid-js";

import type { WorkspaceOwner } from "../workspace-owner.ts";
import { listServerDirectory } from "../opencode/server-directories.ts";

import "./ServerDirectoryBrowser.css";
import { serverPathChild, serverPathParent } from "./serverPath.ts";

export type ServerDirectoryBrowserProps = {
  readonly effects: WorkspaceOwner;
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly requestLocation: LocationRef;
  readonly label: string;
  readonly initialLocation: LocationRef;
  readonly disabled?: boolean;
  readonly validationError?: string;
  readonly onBrowserReady?: (element: HTMLElement) => void;
  readonly onLoadingChange?: (loading: boolean) => void;
  readonly onDirectoryChange: (location: LocationRef | undefined) => void;
};

type DirectoryState = {
  readonly location?: LocationRef;
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
    requestedLocation: props.initialLocation,
    directories: [],
    loading: true,
  });
  onCleanup(effects.registry.mount(state));
  const snapshot = useAtomValue(() => state);
  const location = () => snapshot().requestedLocation;
  const directories = () => snapshot().directories;
  const loading = () => snapshot().loading;
  const error = () => snapshot().error;
  let browserElement: HTMLElement | undefined;
  let entriesList: HTMLUListElement | undefined;
  let requestLocation = props.requestLocation;
  const request = effects.latest();
  onCleanup(request.cancel);

  const focusStableControl = (): void => {
    queueMicrotask(() => {
      const target =
        browserElement?.querySelector<HTMLElement>(
          ".server-directory-listing-error button:not([disabled])",
        ) ??
        browserElement?.querySelector<HTMLElement>("button:not([disabled])") ??
        browserElement;
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
      const response = yield* listServerDirectory(
        effects,
        props.listDirectory,
        requestLocation,
        requestedLocation.directory,
      );
      requestLocation = response.context;
      const workspaceID = response.context.workspaceID;
      const resolvedLocation: LocationRef =
        workspaceID === undefined
          ? { directory: requestedLocation.directory }
          : { directory: requestedLocation.directory, workspaceID };
      const hadResolvedDirectory = effects.registry.get(state).location !== undefined;
      effects.registry.set(state, {
        location: resolvedLocation,
        requestedLocation: resolvedLocation,
        directories: response.directories,
        loading: false,
      });
      props.onLoadingChange?.(false);
      if (entriesList) entriesList.scrollTop = 0;
      props.onDirectoryChange(resolvedLocation);
      if (hadResolvedDirectory || browserElement?.contains(document.activeElement)) {
        focusStableControl();
      }
    },
    Effect.catchTag("WorkspaceRequestError", ({ cause }) =>
      Effect.sync(() => {
        effects.registry.update(state, (current) => ({
          ...current,
          loading: false,
          error: errorMessage(cause),
        }));
        props.onLoadingChange?.(false);
        props.onDirectoryChange(undefined);
        focusStableControl();
      }),
    ),
  );

  const loadDirectory = (requestedLocation: LocationRef): void => {
    request.run(readDirectory(requestedLocation));
  };

  createEffect(() => {
    requestLocation = props.requestLocation;
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
          <span class="server-directory-browser-path">{location().directory}</span>
          <Show when={loading() || error()}>
            <span class="server-directory-browser-status">
              {loading() ? "Listing…" : "Not listed"}
            </span>
          </Show>
          <Show when={error() ? snapshot().location : undefined}>
            {(previousLocation) => (
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                disabled={navigationDisabled()}
                aria-label="Back to previous successfully listed directory"
                title={previousLocation().directory}
                onClick={() => loadDirectory(previousLocation())}
              >
                <Icon name="arrow-left" />
                <span>Back</span>
              </Button>
            )}
          </Show>
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
              <span>
                Could not list {location().directory}. {listingError()}
              </span>
              <Button
                type="button"
                size="small"
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
