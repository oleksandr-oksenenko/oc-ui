import { Show, createMemo, createSignal } from "solid-js";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { DiffChanges } from "@opencode-ai/ui/diff-changes";

import { PierreDiffBody } from "./DiffFile/PierreDiffBody.tsx";
import type { DiffFileReview } from "./diff-render-data.ts";
import { prepareDiffRender } from "./diff-render-data.ts";
export { parseFilePatch } from "./diff-render-data.ts";

export type DiffFileData = {
  readonly path: string;
  readonly patch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: "added" | "deleted" | "modified";
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
            class="diff-file-toggle"
            aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.file.path}`}
          >
            <span class="diff-file-name">
              <Collapsible.Arrow class="diff-file-disclosure" />
              <span title={props.file.path}>{props.file.path}</span>
            </span>
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
              <PierreDiffBody diff={diff()} path={props.file.path} review={props.review} />
            )}
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </article>
  );
}
