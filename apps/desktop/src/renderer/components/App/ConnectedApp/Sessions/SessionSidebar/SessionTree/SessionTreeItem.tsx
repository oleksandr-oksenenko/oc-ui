import type { SessionAttentionState } from "../../session-attention-rollup.ts";
import { Collapsible } from "@opencode/ui/collapsible";
import { Loader } from "../../../../../../ui/Loader.tsx";
import type { Project, SessionInfo } from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import type { JSX } from "solid-js";
import { RemoveButton } from "../../../../../../ui/RemoveButton.tsx";

import { SessionRow } from "../../../../../../ui/SessionRow.tsx";
import { sessionProjectLabel } from "../../session-project-label.ts";

export type SessionTreeItemProps = {
  readonly session: SessionInfo;
  readonly projects?: readonly Project[];
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
  const title = () => props.session.title?.trim() || "Untitled session";
  const project = () => sessionProjectLabel(props.session.projectID, props.projects ?? []);
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
        <SessionRow
          title={title()}
          subtitle={project()}
          label={`${title()}, ${statusLabel()}`}
          selected={props.selected}
          hasChildren={props.hasChildren}
          sidebarVisible={props.sidebarVisible}
          onSelect={() => {
            if (props.hasChildren && props.selected) props.onToggleExpanded(props.session.id);
            props.onSelect(props.session.id);
          }}
          disclosure={
            <>
              {props.hasChildren ? (
                <Collapsible.Trigger
                  class="shell-session-disclosure"
                  type="button"
                  aria-label={props.expanded ? `Collapse ${title()}` : `Expand ${title()}`}
                >
                  <Collapsible.Arrow />
                </Collapsible.Trigger>
              ) : null}
            </>
          }
          end={
            <>
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
            </>
          }
        />
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Collapsible>
    </div>
  );
}
