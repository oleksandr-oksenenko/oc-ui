import type { FileListOutput, OpenCodeClient } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import "./ServerDirectoryBrowser.css";

export type ServerDirectoryBrowserProps = {
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly label: string;
  readonly initialDirectory: string;
  readonly initialPath?: string;
  readonly disabled?: boolean;
  readonly validationError?: string;
  readonly onBrowserReady?: (element: HTMLElement) => void;
  readonly onDirectoryChange: (directory: string) => void;
};

export function ServerDirectoryBrowser(props: ServerDirectoryBrowserProps) {
  const initialLocation = createMemo(
    () => [props.initialDirectory, props.initialPath ?? "."] as const,
  );
  const [directory, setDirectory] = createSignal(props.initialDirectory);
  const [directories, setDirectories] = createSignal<readonly string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  let entriesList: HTMLUListElement | undefined;
  let requestID = 0;

  const loadDirectory = async (baseDirectory: string, path: string): Promise<void> => {
    const request = ++requestID;
    setLoading(true);
    setError(undefined);

    let response: FileListOutput;
    try {
      response = await props.listDirectory({
        location: { directory: baseDirectory },
        path,
      });
    } catch (cause) {
      if (request !== requestID) return;
      setLoading(false);
      setError(errorMessage(cause));
      return;
    }

    if (request !== requestID) return;
    const resolvedDirectory = response.location.directory;
    setDirectory(resolvedDirectory);
    setDirectories(
      response.data.filter((entry) => entry.type === "directory").map((entry) => entry.path),
    );
    setLoading(false);
    if (entriesList) entriesList.scrollTop = 0;
    props.onDirectoryChange(resolvedDirectory);
  };

  createEffect(() => {
    const [baseDirectory, path] = initialLocation();
    void loadDirectory(baseDirectory, path);
  });

  const navigationDisabled = () => props.disabled === true || loading();

  return (
    <section class="server-directory-browser-shell" aria-label={props.label}>
      <Show when={props.validationError}>
        {(validationError) => (
          <p class="server-directory-error" role="alert">
            {validationError()}
          </p>
        )}
      </Show>

      <div
        ref={(element: HTMLDivElement) => props.onBrowserReady?.(element)}
        class="server-directory-browser"
        tabIndex={-1}
        aria-busy={loading() ? "true" : undefined}
      >
        <header class="server-directory-browser-header">
          <span class="server-directory-browser-path">{directory()}</span>
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
                aria-label="Go to parent directory"
                onClick={() => void loadDirectory(directory(), "..")}
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
                    aria-label={`Browse directory ${directoryName}`}
                    onClick={() => void loadDirectory(directory(), directoryName)}
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
