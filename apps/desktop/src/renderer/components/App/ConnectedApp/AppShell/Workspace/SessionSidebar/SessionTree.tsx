import { ScrollView } from "@opencode-ai/ui/scroll-view";
import { For } from "solid-js";

import { SessionTreeItem } from "./SessionTree/SessionTreeItem.tsx";
import "./SessionTree.css";

type SessionNodeStatus = "idle" | "running";

export type SessionNode = {
  readonly id: string;
  readonly title: string;
  readonly status: SessionNodeStatus;
  /** Attention is separate from activity and takes visual precedence over it. */
  readonly needsInput?: boolean;
  readonly children?: readonly SessionNode[];
};

export type SessionTreeProps = {
  readonly nodes: readonly SessionNode[];
  readonly selectedID?: string;
  readonly expandedIDs: readonly string[];
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
};

export function SessionTree(props: SessionTreeProps) {
  const isExpanded = (id: string) => props.expandedIDs.includes(id);

  const renderNodes = (nodes: readonly SessionNode[], depth: number) => (
    <For each={nodes}>
      {(node) => (
        <>
          <SessionTreeItem
            node={node}
            depth={depth}
            selected={props.selectedID === node.id}
            expanded={isExpanded(node.id)}
            onSelect={props.onSelect}
            onToggleExpanded={props.onToggleExpanded}
          >
            {node.children && node.children.length > 0 ? (
              <div class="shell-session-children" style={{ "--session-depth": `${depth + 1}` }}>
                {renderNodes(node.children, depth + 1)}
              </div>
            ) : null}
          </SessionTreeItem>
        </>
      )}
    </For>
  );

  return (
    <ScrollView class="shell-session-tree">
      <nav class="shell-session-tree-content" aria-label="Sessions">
        {renderNodes(props.nodes, 0)}
      </nav>
    </ScrollView>
  );
}
