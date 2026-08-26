import { For, Show } from "solid-js";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { FileIcon } from "@opencode-ai/ui/file-icon";
import { Icon } from "@opencode-ai/ui/icon";

type FileNodeStatus = "added" | "modified" | "deleted";

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

function fileTreeRowContent(props: {
  readonly node: FileTreeNode;
  readonly expanded: boolean;
  readonly disclosure?: boolean;
}) {
  return (
    <>
      <Show
        when={props.disclosure === true}
        fallback={<span class="file-tree-disclosure-spacer" />}
      >
        <Collapsible.Arrow class="file-tree-disclosure" />
      </Show>

      <span class="file-tree-kind" aria-hidden="true">
        <FileIcon
          class="file-tree-icon"
          node={{ path: props.node.name, type: props.node.kind }}
          expanded={props.expanded}
        />
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
                  fallback={<Icon aria-hidden="true" name="trash" size="small" />}
                >
                  <Icon aria-hidden="true" name="pencil-line" size="small" />
                </Show>
              }
            >
              <Icon aria-hidden="true" name="plus-small" size="small" />
            </Show>
            <span class="sr-only">{statusLabel(status())}</span>
          </span>
        )}
      </Show>
    </>
  );
}

export function FileTreeItem(props: FileTreeItemProps) {
  const hasChildren = () =>
    props.node.kind === "directory" && (props.node.children?.length ?? 0) > 0;
  const expanded = () => props.expandedIDs.includes(props.node.id);

  return (
    <div class="file-tree-item">
      <Show when={props.node.kind === "file"}>
        <div
          class="file-tree-row file-tree-file-row"
          style={{ "padding-left": `${8 + props.depth * 15}px` }}
        >
          {fileTreeRowContent({ node: props.node, expanded: expanded() })}
        </div>
      </Show>

      <Show when={props.node.kind === "directory"}>
        <Collapsible
          class="file-tree-collapsible"
          variant="ghost"
          open={expanded()}
          onOpenChange={(open) => {
            if (hasChildren() && open !== expanded()) props.onToggleExpanded(props.node.id);
          }}
        >
          <Collapsible.Trigger
            class="file-tree-row file-tree-directory-row"
            style={{ "padding-left": `${8 + props.depth * 15}px` }}
            disabled={!hasChildren()}
            aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.node.name}`}
          >
            {fileTreeRowContent({
              node: props.node,
              expanded: expanded(),
              disclosure: true,
            })}
          </Collapsible.Trigger>
          <Collapsible.Content class="file-tree-children">
            <For each={props.node.children ?? []}>
              {(child) => (
                <FileTreeItem
                  node={child}
                  depth={props.depth + 1}
                  expandedIDs={props.expandedIDs}
                  onToggleExpanded={props.onToggleExpanded}
                />
              )}
            </For>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  );
}
