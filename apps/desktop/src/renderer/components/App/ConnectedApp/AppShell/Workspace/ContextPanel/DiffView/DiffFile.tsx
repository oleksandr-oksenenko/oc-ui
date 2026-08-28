import { parsePatchFiles, processFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { Show, createMemo, createSignal } from "solid-js";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { DiffChanges } from "@opencode-ai/ui/diff-changes";

import { PierreDiffBody } from "./DiffFile/PierreDiffBody.tsx";

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
};

export function DiffFile(props: DiffFileProps) {
  const [expanded, setExpanded] = createSignal(props.file.defaultExpanded ?? true);
  const parsed = createMemo(() => parseFilePatch(props.file));

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
            when={parsed()}
            fallback={<p class="diff-file-unavailable">This patch could not be displayed.</p>}
          >
            {(fileDiff) => <PierreDiffBody fileDiff={fileDiff()} path={props.file.path} />}
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </article>
  );
}

export function parseFilePatch(file: DiffFileData): FileDiffMetadata | undefined {
  try {
    const candidates = parsePatchFiles(file.patch, undefined, true).flatMap((patch) => patch.files);
    const parsed = candidates.find((candidate) => candidate.name === file.path) ?? candidates[0];
    const fallback =
      parsed ??
      processFile(`--- a/${file.path}\n+++ b/${file.path}\n${file.patch}`, {
        throwOnError: true,
      });
    if (!fallback || fallback.hunks.length === 0) return undefined;
    return {
      ...fallback,
      name: file.path,
      type: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "change",
    };
  } catch {
    return undefined;
  }
}
