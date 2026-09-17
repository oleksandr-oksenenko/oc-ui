import { Collapsible } from "@opencode/ui/collapsible";
import { DiffChanges } from "@opencode/ui/diff-changes";
import { Tooltip } from "@opencode/ui/tooltip";
import { Show } from "solid-js";

export type DiffFileHeaderProps = {
  readonly path: string;
  readonly expanded: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly onToggle: (expanded: boolean) => void;
};

/**
 * The panel-owned header for one CodeView item. Pierre projects this element
 * through its custom header slot, so it stays in light DOM and keeps the
 * panel's CSS, button semantics, and accessible disclosure label.
 */
export function DiffFileHeader(props: DiffFileHeaderProps) {
  return (
    <header class="diff-file-header">
      <button
        type="button"
        class="diff-file-toggle oc-focus-inset"
        ref={(element) => {
          element.dataset.diffFileToggle = props.path;
        }}
        aria-expanded={props.expanded ? "true" : "false"}
        aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.path}`}
        onClick={() => props.onToggle(!props.expanded)}
      >
        {/* The tooltip trigger stays inside the disclosure button: the
            upstream Tooltip suppresses itself when a trigger descendant
            reports an expanded disclosure, so wrapping the button would
            disable it for open files. */}
        <Tooltip class="diff-file-name" contentClass="diff-file-path-tooltip" value={props.path}>
          <Collapsible.Arrow class="diff-file-disclosure" />
          {/* `truncate-start` clips the beginning of the path; the LTR base
              direction keeps the file name at the visible end. */}
          <span class="diff-file-path truncate-start">
            <bdi dir="ltr">{props.path}</bdi>
          </span>
        </Tooltip>
      </button>
      <div class="diff-file-stats">
        <span class="sr-only">
          {props.additions} additions, {props.deletions} deletions
        </span>
        <Show when={props.additions + props.deletions > 0}>
          <div aria-hidden="true">
            <DiffChanges
              changes={{ additions: props.additions, deletions: props.deletions }}
              appearance="compact"
            />
          </div>
        </Show>
      </div>
    </header>
  );
}
