import { For, Show } from "solid-js";
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconPencil,
  IconTrash,
} from "@tabler/icons-solidjs";

export type FileNodeStatus = "added" | "modified" | "deleted";

export type FileTreeNode = {
  readonly id: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly children?: readonly FileTreeNode[];
  readonly status?: FileNodeStatus;
};

export type FileTreeItemProps = {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly expandedIDs: readonly string[];
  readonly onToggleExpanded: (id: string) => void;
};

function statusLabel(status: FileNodeStatus): string {
  if (status === "added") return "Added";
  if (status === "modified") return "Modified";
  return "Deleted";
}

export function FileTreeItem(props: FileTreeItemProps) {
  const hasChildren = () =>
    props.node.kind === "directory" && (props.node.children?.length ?? 0) > 0;
  const expanded = () => props.expandedIDs.includes(props.node.id);

  return (
    <div class="file-tree-item">
      <div
        class="file-tree-row"
        classList={{ directory: props.node.kind === "directory" }}
        style={{ "padding-left": `${8 + props.depth * 15}px` }}
      >
        <Show
          when={props.node.kind === "directory"}
          fallback={<span class="file-tree-disclosure-spacer" aria-hidden="true" />}
        >
          <button
            class="file-tree-disclosure"
            type="button"
            aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.node.name}`}
            aria-expanded={expanded()}
            disabled={!hasChildren()}
            onClick={() => props.onToggleExpanded(props.node.id)}
          >
            <Show
              when={expanded()}
              fallback={<IconChevronRight aria-hidden="true" size="14" stroke="1.8" />}
            >
              <IconChevronDown aria-hidden="true" size="14" stroke="1.8" />
            </Show>
          </button>
        </Show>

        <span class="file-tree-kind" aria-hidden="true">
          <Show
            when={props.node.kind === "directory"}
            fallback={<IconFile size="14" stroke="1.7" />}
          >
            <Show when={expanded()} fallback={<IconFolder size="14" stroke="1.7" />}>
              <IconFolderOpen size="14" stroke="1.7" />
            </Show>
          </Show>
        </span>
        <span class="file-tree-name" title={props.node.name}>
          {props.node.name}
        </span>
        <Show when={props.node.status}>
          {(status) => (
            <span class={`file-tree-status ${status()}`} title={statusLabel(status())}>
              <Show
                when={status() === "added"}
                fallback={
                  <Show
                    when={status() === "modified"}
                    fallback={<IconTrash aria-hidden="true" size="13" stroke="1.8" />}
                  >
                    <IconPencil aria-hidden="true" size="13" stroke="1.8" />
                  </Show>
                }
              >
                <IconPlus aria-hidden="true" size="13" stroke="1.8" />
              </Show>
              <span class="sr-only">{statusLabel(status())}</span>
            </span>
          )}
        </Show>
      </div>

      <Show when={props.node.kind === "directory" && expanded() && hasChildren()}>
        <div class="file-tree-children">
          <For each={props.node.children}>
            {(child) => (
              <FileTreeItem
                node={child}
                depth={props.depth + 1}
                expandedIDs={props.expandedIDs}
                onToggleExpanded={props.onToggleExpanded}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
