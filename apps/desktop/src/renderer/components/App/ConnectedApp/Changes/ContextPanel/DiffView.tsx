import { Button } from "@opencode/ui/button";
import { DiffChanges } from "@opencode/ui/diff-changes";
import { Icon } from "@opencode/ui/icon";
import { Loader } from "@opencode/ui/loader";
import { Select } from "@opencode/ui/select";
import type { SelectedLineRange } from "@pierre/diffs";
import { createMemo, For, Show } from "solid-js";

import { DiffFile } from "./DiffView/DiffFile.tsx";
import type { DiffFileData } from "./DiffView/DiffFile.tsx";
import type { DiffFileReview, ReviewComment } from "./DiffView/diff-render-data.ts";

export type DiffReviewView = {
  readonly comments: readonly ReviewComment[];
  readonly editingCommentID?: string;
  readonly selectedLines?: { readonly path: string; readonly range: SelectedLineRange } | null;
  readonly onBeginComment?: (
    path: string,
    selection: SelectedLineRange,
    selectedCode: string,
  ) => void;
  readonly onUpdateCommentBody?: (commentID: string, body: string) => void;
  readonly onEditComment?: (commentID: string) => void;
  readonly onFinishComment?: (commentID: string) => void;
  readonly onRemoveComment?: (commentID: string, opener: HTMLElement) => void;
};

export type DiffViewProps = {
  readonly files: readonly DiffFileData[];
  readonly loading: boolean;
  readonly error?: string;
  readonly emptyMessage?: string;
  readonly emptyDescription?: string;
  readonly onRetry?: () => void;
  readonly stale?: boolean;
  readonly comparison?: string;
  readonly comparisonOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly onComparisonChange?: (value: string) => void;
  /** Controlled review interaction. No review state is created by DiffView. */
  readonly review?: DiffReviewView;
};

const defaultComparisonOptions = [{ value: "working", label: "Working changes" }] as const;

export function DiffView(props: DiffViewProps) {
  const additions = () => props.files.reduce((total, file) => total + file.additions, 0);
  const deletions = () => props.files.reduce((total, file) => total + file.deletions, 0);
  const comparisonOptions = createMemo<{ readonly value: string; readonly label: string }[]>(() =>
    props.comparisonOptions && props.comparisonOptions.length > 0
      ? props.comparisonOptions.map((option) => option)
      : [...defaultComparisonOptions],
  );
  const comparison = () => props.comparison ?? comparisonOptions()[0]?.value ?? "working";
  const selectedComparison = () =>
    comparisonOptions().find((option) => option.value === comparison()) ?? comparisonOptions()[0];

  return (
    <section class="context-view diff-view" aria-label="Diff">
      <Show when={props.files.length > 0 || comparisonOptions().length > 1}>
        <div class="diff-summary">
          <Show when={comparisonOptions().length > 1}>
            <Select
              class="diff-comparison-select"
              aria-label="Diff comparison"
              options={comparisonOptions()}
              current={selectedComparison()}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => {
                if (option) props.onComparisonChange?.(option.value);
              }}
            />
          </Show>
          <Show when={props.files.length > 0}>
            <span class="diff-summary-count">
              {props.files.length} {props.files.length === 1 ? "file" : "files"}
            </span>
            <div class="diff-summary-changes">
              <span class="sr-only">
                {additions()} additions, {deletions()} deletions
              </span>
              <div aria-hidden="true">
                <DiffChanges
                  changes={{ additions: additions(), deletions: deletions() }}
                  appearance="compact"
                />
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.error && props.files.length === 0}>
        {(error) => (
          <div class="context-state error-state" role="alert">
            <Icon aria-hidden="true" name="warning" size="small" />
            <p>{error()}</p>
            <Show when={props.onRetry}>
              <Button
                size="normal"
                variant="outline"
                type="button"
                onClick={() => props.onRetry?.()}
              >
                Retry
              </Button>
            </Show>
          </div>
        )}
      </Show>

      <Show when={!props.error && props.loading && props.files.length === 0}>
        <output class="context-state loading-state">
          <Loader class="context-spinner" width="18" height="18" aria-hidden="true" />
          <span>Loading diff</span>
        </output>
      </Show>

      <Show when={!props.error && !props.loading && props.files.length === 0}>
        <div class="context-state empty-state">
          <p>{props.emptyMessage ?? "No working tree changes"}</p>
          <Show when={props.emptyDescription}>{(description) => <span>{description()}</span>}</Show>
        </div>
      </Show>

      <Show when={props.files.length > 0}>
        <>
          <Show when={props.loading}>
            <output class="diff-refresh-state">
              <Loader class="context-spinner" width="14" height="14" aria-hidden="true" />
              <span>Refreshing diff</span>
            </output>
          </Show>
          <Show when={props.error}>
            {(error) => (
              <div class="diff-refresh-state error-state" role="alert">
                <span>{error()}</span>
                <Show when={props.onRetry}>
                  <Button
                    size="normal"
                    variant="outline"
                    type="button"
                    onClick={() => props.onRetry?.()}
                  >
                    Retry
                  </Button>
                </Show>
              </div>
            )}
          </Show>
          <Show when={props.stale && !props.loading && !props.error}>
            <p class="diff-refresh-state">Showing cached changes</p>
          </Show>
          <div class="diff-file-list">
            <For each={props.files}>
              {(file) => {
                const review = () => props.review;
                const fileReview: DiffFileReview | undefined = review()
                  ? {
                      get comments() {
                        return (
                          review()?.comments.filter((comment) => comment.path === file.file) ?? []
                        );
                      },
                      get editingCommentID() {
                        return review()?.editingCommentID;
                      },
                      get selection() {
                        const selected = review()?.selectedLines;
                        return selected?.path === file.file ? selected.range : null;
                      },
                      onBeginComment: (selection, selectedCode) =>
                        review()?.onBeginComment?.(file.file, selection, selectedCode),
                      onUpdateCommentBody: (commentID, body) =>
                        review()?.onUpdateCommentBody?.(commentID, body),
                      onEditComment: (commentID) => review()?.onEditComment?.(commentID),
                      onFinishComment: (commentID) => review()?.onFinishComment?.(commentID),
                      onRemoveComment: (commentID, opener) =>
                        review()?.onRemoveComment?.(commentID, opener),
                    }
                  : undefined;
                return <DiffFile file={file} review={fileReview} />;
              }}
            </For>
          </div>
        </>
      </Show>
    </section>
  );
}
