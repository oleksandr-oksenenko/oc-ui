import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import type { JSX } from "solid-js";

import type { SessionNode } from "../SessionTree.tsx";
import "./SessionTreeItem.css";

export type SessionTreeItemProps = {
  readonly node: SessionNode;
  readonly depth: number;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly children?: JSX.Element;
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
  const showsStatus = () =>
    props.node.needsInput === true ||
    props.node.status === "running" ||
    props.node.status === "creating";

  return (
    <div class="shell-session-tree-item" style={{ "--session-depth": `${props.depth}` }}>
      <Collapsible
        class="shell-session-collapsible"
        variant="ghost"
        open={props.expanded}
        onOpenChange={(open) => {
          if (hasChildren() && open !== props.expanded) props.onToggleExpanded(props.node.id);
        }}
      >
        <div
          class="shell-session-row"
          classList={{ selected: props.selected, "has-children": hasChildren() }}
        >
          {hasChildren() ? (
            <span class="shell-session-disclosure-slot">
              <Collapsible.Trigger
                class="shell-session-disclosure"
                type="button"
                aria-label={
                  props.expanded ? `Collapse ${props.node.title}` : `Expand ${props.node.title}`
                }
              >
                <Collapsible.Arrow />
              </Collapsible.Trigger>
            </span>
          ) : null}
          <Button
            class="shell-session-main"
            type="button"
            size="small"
            variant="ghost-muted"
            aria-current={props.selected ? "page" : undefined}
            aria-label={`${props.node.title}, ${statusLabel()}`}
            onClick={() => props.onSelect(props.node.id)}
          >
            <span class="shell-session-title">{props.node.title.trim() || "Untitled session"}</span>
            {showsStatus() ? (
              <span
                class="shell-session-status"
                data-status={props.node.needsInput === true ? "needs-input" : props.node.status}
                aria-label={statusLabel()}
                title={statusLabel()}
              >
                {props.node.needsInput === true ? (
                  <Icon name="prompt" size="small" />
                ) : (
                  <Loader width={13} height={13} />
                )}
              </span>
            ) : null}
          </Button>
        </div>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Collapsible>
    </div>
  );
}
