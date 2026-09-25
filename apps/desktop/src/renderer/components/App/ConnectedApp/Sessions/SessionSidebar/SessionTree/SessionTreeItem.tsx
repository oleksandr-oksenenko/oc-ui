import type { SessionAttentionState } from "../../session-attention-rollup.ts";
import { Collapsible } from "@opencode/ui/collapsible";
import { Button } from "@opencode/ui/button";
import { Loader } from "@opencode/ui/loader";
import { Tooltip } from "@opencode/ui/tooltip";
import type { SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { createEffect, createSignal, type JSX } from "solid-js";
import { RemoveButton } from "../../../../../../ui/RemoveButton.tsx";

import "./SessionTreeItem.css";

export type SessionTreeItemProps = {
  readonly session: SessionInfo;
  readonly attention?: SessionAttentionState;
  readonly status: DataSessionStatus;
  readonly hasChildren: boolean;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly deleteDisabled: boolean;
  readonly deleteDisabledReason?: string;
  readonly sidebarVisible?: boolean;
  readonly children?: JSX.Element;
  readonly onSelect: (sessionID: string) => void;
  readonly onToggleExpanded: (sessionID: string) => void;
  readonly onDelete: (sessionID: string, opener: HTMLButtonElement) => void;
};

export function SessionTreeItem(props: SessionTreeItemProps) {
  const [titleFocused, setTitleFocused] = createSignal(false);
  createEffect(() => {
    if (props.sidebarVisible === false) setTitleFocused(false);
  });
  const title = () => props.session.title?.trim() || "Untitled session";
  const inherited = () => props.attention?.origin === "subagents";
  const statusLabel = () => {
    const attention = props.attention;
    if (attention?.kind === "permission") {
      return inherited() ? "Subagent permission required" : "Permission required";
    }
    if (attention?.kind === "question") {
      return inherited() ? "Subagent question awaiting answer" : "Question awaiting answer";
    }
    if (attention?.kind === "completed") return "Turn completed";
    return props.status === "running" ? "Running" : "Idle";
  };

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
          <Tooltip
            inactive={props.sidebarVisible === false}
            class="shell-session-title-tooltip-trigger"
            contentClass="shell-session-title-tooltip"
            appearance="standard"
            forceOpen={titleFocused() ? true : undefined}
            value={title()}
          >
            <Button
              class="shell-session-main oc-focus-inset"
              type="button"
              size="small"
              variant="ghost-muted"
              aria-current={props.selected ? "page" : undefined}
              aria-label={`${title()}, ${statusLabel()}`}
              onFocus={(event: FocusEvent & { currentTarget: HTMLButtonElement }) =>
                setTitleFocused(event.currentTarget.matches(":focus-visible"))
              }
              onBlur={() => setTitleFocused(false)}
              onPointerDown={() => setTitleFocused(false)}
              onKeyDown={(event: KeyboardEvent) => {
                setTitleFocused(event.key !== "Enter" && event.key !== " ");
              }}
              onClick={() => {
                if (props.hasChildren && props.selected) props.onToggleExpanded(props.session.id);
                props.onSelect(props.session.id);
              }}
            >
              <span class="shell-session-title">{title()}</span>
            </Button>
          </Tooltip>
          <span class="shell-session-row-end">
            {props.attention || props.status === "running" ? (
              <span
                class="shell-session-status"
                data-status={props.attention?.kind ?? props.status}
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
            <RemoveButton
              class="shell-session-delete"
              disabled={props.deleteDisabled}
              label={`Delete ${title()}`}
              title={props.deleteDisabledReason ?? `Delete ${title()}`}
              onClick={(event) => props.onDelete(props.session.id, event.currentTarget)}
            />
          </span>
        </div>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Collapsible>
    </div>
  );
}
