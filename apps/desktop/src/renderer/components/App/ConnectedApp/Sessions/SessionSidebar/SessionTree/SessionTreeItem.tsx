import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Loader } from "@opencode-ai/ui/loader";
import type { SessionInfo } from "@opencode-ai/client";
import type { DataSessionStatus } from "@opencode-ai/client/solid";
import type { JSX } from "solid-js";

import "./SessionTreeItem.css";

export type SessionTreeItemProps = {
  readonly session: SessionInfo;
  readonly status: DataSessionStatus;
  readonly requiresInput?: boolean;
  readonly hasChildren: boolean;
  readonly depth: number;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly deleteDisabled: boolean;
  readonly deleteDisabledReason?: string;
  readonly children?: JSX.Element;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

export function SessionTreeItem(props: SessionTreeItemProps) {
  const title = () => props.session.title?.trim() || "Untitled session";
  const statusLabel = () =>
    props.status === "running" ? "Running" : props.requiresInput ? "Requires input" : "Idle";

  return (
    <div class="shell-session-tree-item" style={{ "--session-depth": `${props.depth}` }}>
      <Collapsible
        class="shell-session-collapsible"
        variant="ghost"
        open={props.expanded}
        onOpenChange={(open) => {
          if (props.hasChildren && open !== props.expanded) {
            props.onToggleExpanded(props.session.id);
          }
        }}
      >
        <div
          class="shell-session-row"
          classList={{ selected: props.selected, "has-children": props.hasChildren }}
        >
          <span class="shell-session-disclosure-slot">
            {props.hasChildren ? (
              <Collapsible.Trigger
                class="shell-session-disclosure"
                type="button"
                aria-label={props.expanded ? `Collapse ${title()}` : `Expand ${title()}`}
              >
                <Collapsible.Arrow />
              </Collapsible.Trigger>
            ) : null}
          </span>
          <Button
            class="shell-session-main"
            type="button"
            size="small"
            variant="ghost-muted"
            aria-current={props.selected ? "page" : undefined}
            aria-label={`${title()}, ${statusLabel()}`}
            onClick={() => props.onSelect(props.session.id)}
          >
            <span class="shell-session-title">{title()}</span>
          </Button>
          <span class="shell-session-row-end">
            {props.status === "running" ? (
              <span
                class="shell-session-status"
                data-status={props.status}
                aria-hidden="true"
                title={statusLabel()}
              >
                <Loader width={13} height={13} />
              </span>
            ) : props.requiresInput ? (
              <span
                class="shell-session-status"
                data-status="requires-input"
                aria-hidden="true"
                title={statusLabel()}
              >
                <span class="shell-session-input-required" aria-hidden="true" />
              </span>
            ) : null}
            <IconButton
              class="shell-session-delete"
              type="button"
              size="small"
              variant="ghost-muted"
              disabled={props.deleteDisabled}
              aria-label={`Delete ${title()}`}
              title={props.deleteDisabledReason ?? `Delete ${title()}`}
              icon={<Icon name="trash" size="small" aria-hidden="true" />}
              onClick={(event) => props.onDelete(props.session.id, event.currentTarget)}
            />
          </span>
        </div>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Collapsible>
    </div>
  );
}
