import { For, Show } from "solid-js";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";

import { FileTreeItem } from "./FilesView/FileTreeItem.tsx";
import type { FileTreeNode } from "./FilesView/FileTreeItem.tsx";

export type FilesViewProps = {
  readonly nodes: readonly FileTreeNode[];
  readonly loading: boolean;
  readonly error?: string;
  readonly emptyMessage?: string;
  readonly emptyDescription?: string;
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
            <Icon aria-hidden="true" name="warning" size="small" />
            <p>{error()}</p>
            <Show when={props.onRetry}>
              <Button
                class="context-retry"
                size="small"
                variant="outline"
                type="button"
                onClick={() => props.onRetry?.()}
              >
                Retry
              </Button>
            </Show>
          </div>
        )}
      </Show>

      <Show when={!props.error && props.loading && props.nodes.length === 0}>
        <output class="context-state loading-state">
          <Loader class="context-spinner" width="18" height="18" aria-hidden="true" />
          <span>Loading files</span>
        </output>
      </Show>

      <Show when={!props.error && !props.loading && props.nodes.length === 0}>
        <div class="context-state empty-state">
          <p>{props.emptyMessage ?? "No files to show"}</p>
          <span>{props.emptyDescription ?? "The selected context has no files."}</span>
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
