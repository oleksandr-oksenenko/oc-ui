import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from "solid-js";

import "./ServerDirectoryBrowser.css";

export type ServerDirectoryBrowserProps = {
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly label: string;
  readonly initialLocation: LocationRef;
  readonly initialPath?: string;
  readonly disabled?: boolean;
  readonly validationError?: string;
  readonly onBrowserReady?: (element: HTMLElement) => void;
  readonly onLoadingChange?: (loading: boolean) => void;
  readonly onDirectoryChange: (location: LocationRef) => void;
};

type DirectoryRequest = {
  readonly location: LocationRef;
  readonly path: string;
};

type DirectoryListInput = NonNullable<Parameters<OpenCodeClient["file"]["list"]>[0]>;

export function ServerDirectoryBrowser(props: ServerDirectoryBrowserProps) {
  const validationErrorId = createUniqueId();
  const initialLocation = createMemo(() => props.initialLocation);
  const [location, setLocation] = createSignal<LocationRef>(props.initialLocation);
  const [directories, setDirectories] = createSignal<readonly string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  let browserElement: HTMLElement | undefined;
  let entriesList: HTMLUListElement | undefined;
  let hasResolvedDirectory = false;
  let requestID = 0;
  let retryInput: DirectoryRequest = {
    location: props.initialLocation,
    path: props.initialPath ?? ".",
  };

  const setBrowserLoading = (next: boolean): void => {
    setLoading(next);
    props.onLoadingChange?.(next);
  };

  const focusStableControl = (): void => {
    queueMicrotask(() => {
      const target =
        browserElement?.querySelector<HTMLElement>("button:not([disabled])") ?? browserElement;
      target?.focus();
    });
  };

  const loadDirectory = async (baseLocation: LocationRef, path: string): Promise<void> => {
    const request = ++requestID;
    retryInput = { location: baseLocation, path };
    setBrowserLoading(true);
    setError(undefined);

    let response: FileListOutput;
    try {
      const requestLocation: NonNullable<DirectoryListInput["location"]> =
        baseLocation.workspaceID === undefined
          ? { directory: baseLocation.directory }
          : { directory: baseLocation.directory, workspace: baseLocation.workspaceID };
      response = await props.listDirectory({ location: requestLocation, path });
    } catch (cause) {
      if (request !== requestID) return;
      setBrowserLoading(false);
      setError(errorMessage(cause));
      focusStableControl();
      return;
    }

    if (request !== requestID) return;
    const workspaceID = response.location.workspaceID;
    const resolvedLocation: LocationRef =
      workspaceID === undefined
        ? { directory: response.location.directory }
        : {
            directory: response.location.directory,
            workspaceID,
          };
    setLocation(resolvedLocation);
    setDirectories(
      response.data.filter((entry) => entry.type === "directory").map((entry) => entry.path),
    );
    setBrowserLoading(false);
    if (entriesList) entriesList.scrollTop = 0;
    props.onDirectoryChange(resolvedLocation);
    if (hasResolvedDirectory || browserElement?.contains(document.activeElement)) {
      focusStableControl();
    }
    hasResolvedDirectory = true;
  };

  createEffect(() => {
    void loadDirectory(initialLocation(), props.initialPath ?? ".");
  });

  const navigationDisabled = () => props.disabled === true || loading();

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
                size="small"
                variant="outline"
                disabled={navigationDisabled()}
                onClick={() => void loadDirectory(retryInput.location, retryInput.path)}
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
            class="server-directory-entries"
            aria-label="Directories"
          >
            <li>
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                disabled={navigationDisabled()}
                aria-describedby={props.validationError ? validationErrorId : undefined}
                aria-label="Go to parent directory"
                onClick={() => void loadDirectory(location(), "..")}
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
                    onClick={() => void loadDirectory(location(), directoryName)}
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
