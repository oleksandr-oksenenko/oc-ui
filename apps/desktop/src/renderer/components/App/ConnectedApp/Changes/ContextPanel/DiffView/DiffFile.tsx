import type { FileDiffInfo } from "@opencode/client";
import { Show, createMemo, createSignal } from "solid-js";
import { Collapsible } from "@opencode/ui/collapsible";
import { DiffChanges } from "@opencode/ui/diff-changes";
import { Tooltip } from "@opencode/ui/tooltip";

import { PierreDiffBody } from "./DiffFile/PierreDiffBody.tsx";
import type { DiffFileReview } from "./diff-render-data.ts";
import { prepareDiffRender } from "./diff-render-data.ts";
export { parseFilePatch } from "./diff-render-data.ts";

export type DiffFileData = FileDiffInfo & {
  readonly defaultExpanded?: boolean;
};

type DiffFileProps = {
  readonly file: DiffFileData;
  readonly review?: DiffFileReview;
};

export function DiffFile(props: DiffFileProps) {
  const [expanded, setExpanded] = createSignal(props.file.defaultExpanded ?? true);
  const renderData = createMemo(() => prepareDiffRender(props.file));

  return (
    <article class="diff-file">
      <Collapsible
        class="diff-file-collapsible"
        variant="ghost"
        open={expanded()}
        onOpenChange={setExpanded}
      >
        <header class="diff-file-header">
          <Collapsible.Trigger
            class="diff-file-toggle oc-focus-inset"
            aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.file.file}`}
          >
            {/* The tooltip trigger stays inside the disclosure button: the
                upstream Tooltip suppresses itself when a trigger descendant
                reports an expanded disclosure, so wrapping the button would
                disable it for open files. */}
            <Tooltip
              class="diff-file-name"
              contentClass="diff-file-path-tooltip"
              value={props.file.file}
            >
              <Collapsible.Arrow class="diff-file-disclosure" />
              {/* `truncate-start` clips the beginning of the path; the LTR base
                  direction keeps the file name at the visible end. */}
              <span class="diff-file-path truncate-start">
                <bdi dir="ltr">{props.file.file}</bdi>
              </span>
            </Tooltip>
          </Collapsible.Trigger>
          <div class="diff-file-stats">
            <span class="sr-only">
              {props.file.additions} additions, {props.file.deletions} deletions
            </span>
            <div aria-hidden="true">
              <DiffChanges
                changes={{ additions: props.file.additions, deletions: props.file.deletions }}
                appearance="compact"
              />
            </div>
          </div>
        </header>

        <Collapsible.Content class="diff-file-content">
          <Show
            when={renderData()}
            fallback={<p class="diff-file-unavailable">This patch could not be displayed.</p>}
          >
            {(diff) => (
              <PierreDiffBody diff={diff()} path={props.file.file} review={props.review} />
            )}
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </article>
  );
}
