import { For, Show } from "solid-js";
import { Icon } from "@opencode/ui/icon";
import { SessionRow } from "../../../../../ui/SessionRow.tsx";
import { RemoveButton } from "../../../../../ui/RemoveButton.tsx";
import "./SessionTree.css";
import { Loader } from "@opencode/ui/loader";
import "./DraftList.css";

export type DraftListProps = {
  readonly drafts: readonly {
    readonly id: string;
    readonly title: string;
    readonly status?: "preparing" | "error" | "interrupted";
    readonly statusMessage?: string;
    readonly deleting?: boolean;
  }[];
  readonly selectedID?: string;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
};

/** Draft rows have no server-session or persistence behavior. */
export function DraftList(props: DraftListProps) {
  return (
    <Show when={props.drafts.length > 0}>
      <section class="session-drafts shell-session-group" aria-label="Drafts">
        <h2>
          Drafts <span class="session-drafts-count">{props.drafts.length}</span>
        </h2>
        <For each={props.drafts}>
          {(draft) => (
            <SessionRow
              title={draft.title}
              label={draft.title}
              selected={props.selectedID === draft.id}
              onSelect={() => props.onSelect(draft.id)}
              end={
                <>
                  <Show when={draft.status}>
                    <span
                      class="shell-session-status"
                      data-status={draft.status === "preparing" ? "running" : undefined}
                      title={
                        draft.statusMessage ??
                        (draft.status === "preparing"
                          ? "Preparing worktree…"
                          : draft.status === "error"
                            ? "Setup failed"
                            : "Interrupted")
                      }
                    >
                      <Show
                        when={draft.status === "preparing"}
                        fallback={<Icon name="warning" size="small" />}
                      >
                        <Loader width={14} height={14} />
                      </Show>
                    </span>
                  </Show>
                  <Show when={draft.status !== "preparing"}>
                    <RemoveButton
                      class="shell-session-delete"
                      label={`Delete draft: ${draft.title}`}
                      disabled={draft.deleting}
                      onClick={() => props.onDelete(draft.id)}
                    />
                  </Show>
                </>
              }
            />
          )}
        </For>
      </section>
    </Show>
  );
}
