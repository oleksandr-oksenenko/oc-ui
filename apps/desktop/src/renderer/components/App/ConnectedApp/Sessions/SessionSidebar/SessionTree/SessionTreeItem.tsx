import type { SessionAttention } from "../../createSessionAttention.ts";
import { Collapsible } from "@opencode/ui/collapsible";
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import type { SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import type { JSX } from "solid-js";

import "./SessionTreeItem.css";

export type SessionTreeItemProps = {
  readonly session: SessionInfo;
  readonly attention?: SessionAttention;
  readonly status: DataSessionStatus;
  readonly hasChildren: boolean;
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
    props.attention === "permission"
      ? "Permission required"
      : props.attention === "question"
        ? "Question awaiting answer"
        : props.attention === "completed"
          ? "Turn completed"
          : props.status === "running"
            ? "Running"
            : "Idle";

  return (
    <div class="shell-session-tree-item">
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
          classList={{
            selected: props.selected,
            "has-children": props.hasChildren,
          }}
        >
          <span class="shell-session-disclosure-slot">
            {props.hasChildren ? (
              <Collapsible.Trigger
                class="shell-session-disclosure oc-focus-inset"
                type="button"
                aria-label={props.expanded ? `Collapse ${title()}` : `Expand ${title()}`}
              >
                <Collapsible.Arrow />
              </Collapsible.Trigger>
            ) : null}
          </span>
          <Button
            class="shell-session-main oc-focus-inset"
            type="button"
            size="small"
            variant="ghost-muted"
            aria-current={props.selected ? "page" : undefined}
            aria-label={`${title()}, ${statusLabel()}`}
            aria-expanded={props.hasChildren ? props.expanded : undefined}
            onClick={() => {
              if (props.hasChildren && props.selected) props.onToggleExpanded(props.session.id);
              props.onSelect(props.session.id);
            }}
          >
            <span class="shell-session-title">{title()}</span>
          </Button>
          <span class="shell-session-row-end">
            {props.attention || props.status === "running" ? (
              <span
                class="shell-session-status"
                data-status={props.attention ?? props.status}
                aria-hidden="true"
                title={statusLabel()}
              >
                {props.attention ? (
                  <span class="shell-session-attention-dot" />
                ) : (
                  <Loader width={14} height={14} aria-hidden="true" />
                )}
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
              icon={<Icon name="close" size="small" aria-hidden="true" />}
              onClick={(event) => props.onDelete(props.session.id, event.currentTarget)}
            />
          </span>
        </div>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Collapsible>
    </div>
  );
}
