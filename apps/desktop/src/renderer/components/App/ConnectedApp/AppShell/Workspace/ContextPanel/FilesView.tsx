import { For, Show } from "solid-js";
import { IconAlertCircle, IconLoader2 } from "@tabler/icons-solidjs";

import { FileTreeItem } from "./FilesView/FileTreeItem.tsx";
import type { FileTreeNode } from "./FilesView/FileTreeItem.tsx";

export type FilesViewProps = {
  readonly nodes: readonly FileTreeNode[];
  readonly loading: boolean;
  readonly error?: string;
  readonly expandedIDs: readonly string[];
  readonly onToggleExpanded: (id: string) => void;
  readonly onRetry?: () => void;
};

export function FilesView(props: FilesViewProps) {
  return (
    <section class="context-view files-view" aria-label="Files">
      <Show when={props.error}>
        {(error) => (
          <div class="context-state error-state" role="alert">
            <IconAlertCircle aria-hidden="true" size="18" stroke="1.7" />
            <p>{error()}</p>
            <Show when={props.onRetry}>
              <button class="context-retry" type="button" onClick={() => props.onRetry?.()}>
                Retry
              </button>
            </Show>
          </div>
        )}
      </Show>

      <Show when={!props.error && props.loading && props.nodes.length === 0}>
        <output class="context-state loading-state">
          <IconLoader2 class="context-spinner" aria-hidden="true" size="18" stroke="1.7" />
          <span>Loading files</span>
        </output>
      </Show>

      <Show when={!props.error && !props.loading && props.nodes.length === 0}>
        <div class="context-state empty-state">
          <p>No files to show</p>
          <span>The selected context has no files.</span>
        </div>
      </Show>

      <Show when={!props.error && props.nodes.length > 0}>
        <nav class="file-tree" aria-label="Project files">
          <For each={props.nodes}>
            {(node) => (
              <FileTreeItem
                node={node}
                depth={0}
                expandedIDs={props.expandedIDs}
                onToggleExpanded={props.onToggleExpanded}
              />
            )}
          </For>
        </nav>
      </Show>
    </section>
  );
}
