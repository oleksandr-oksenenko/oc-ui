import {
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconMessageCircleQuestion,
} from "@tabler/icons-solidjs";

import type { SessionNode } from "../SessionTree.tsx";
import "./SessionTreeItem.css";

export type SessionTreeItemProps = {
  readonly node: SessionNode;
  readonly depth: number;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
};

export function SessionTreeItem(props: SessionTreeItemProps) {
  const hasChildren = () => Boolean(props.node.children?.length);
  const statusLabel = () => {
    if (props.node.needsInput === true) return "Needs your input";
    switch (props.node.status) {
      case "running":
        return "Running";
      case "creating":
        return "Creating";
      default:
        return "Idle";
    }
  };

  return (
    <div class="shell-session-tree-item" style={{ "--session-depth": `${props.depth}` }}>
      <div class="shell-session-row" classList={{ selected: props.selected }}>
        <span class="shell-session-disclosure-slot">
          {hasChildren() ? (
            <button
              class="shell-session-disclosure"
              type="button"
              aria-label={
                props.expanded ? `Collapse ${props.node.title}` : `Expand ${props.node.title}`
              }
              aria-expanded={props.expanded}
              onClick={() => props.onToggleExpanded(props.node.id)}
            >
              {props.expanded ? (
                <IconChevronDown size={13} stroke="1.8" aria-hidden="true" />
              ) : (
                <IconChevronRight size={13} stroke="1.8" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </span>
        <button
          class="shell-session-main"
          type="button"
          aria-current={props.selected ? "page" : undefined}
          aria-label={`${props.node.title}, ${statusLabel()}`}
          onClick={() => props.onSelect(props.node.id)}
        >
          <span class="shell-session-title">{props.node.title.trim() || "Untitled session"}</span>
          <span
            class="shell-session-status"
            data-status={props.node.needsInput === true ? "needs-input" : props.node.status}
            aria-label={statusLabel()}
            title={statusLabel()}
          >
            {props.node.needsInput === true ? (
              <IconMessageCircleQuestion size={13} stroke="1.8" aria-hidden="true" />
            ) : props.node.status === "running" || props.node.status === "creating" ? (
              <IconLoader2 class="shell-spin" size={13} stroke="1.8" aria-hidden="true" />
            ) : null}
          </span>
        </button>
      </div>
    </div>
  );
}
