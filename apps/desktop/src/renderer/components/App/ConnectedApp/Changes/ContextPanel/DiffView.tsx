import { Button } from "@opencode/ui/button";
import { DiffChanges } from "@opencode/ui/diff-changes";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import { Select } from "@opencode/ui/select";
import type { FileDiffInfo } from "@opencode/client";
import type { SelectedLineRange } from "@pierre/diffs";
import { createMemo, createSignal, Show } from "solid-js";

import { DiffCodeView } from "./DiffView/DiffCodeView.tsx";
import type { ReviewComment } from "./DiffView/diff-render-data.ts";

export type DiffFileData = FileDiffInfo & {
  readonly defaultExpanded?: boolean;
};

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

/**
 * Diff presentation that is independent of the file list: status, messages,
 * comparison controls, and actions. The file list travels as its own prop so a
 * status change cannot invalidate consumers of the patches.
 */
export type DiffViewPresentation = {
  readonly loading: boolean;
  readonly error?: string;
  readonly emptyMessage?: string;
  readonly emptyDescription?: string;
  readonly onRetry?: () => void;
  readonly stale?: boolean;
  readonly comparison?: string;
  readonly comparisonOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly onComparisonChange?: (value: string) => void;
};

export type DiffViewProps = {
  readonly files: readonly DiffFileData[];
  readonly presentation: DiffViewPresentation;
  /** Controlled review interaction. No review state is created by DiffView. */
  readonly review?: DiffReviewView;
};

const defaultComparisonOptions = [{ value: "working", label: "Working changes" }] as const;

export function DiffView(props: DiffViewProps) {
  const additions = () => props.files.reduce((total, file) => total + file.additions, 0);
  const deletions = () => props.files.reduce((total, file) => total + file.deletions, 0);
  const comparisonOptions = createMemo<{ readonly value: string; readonly label: string }[]>(() =>
    props.presentation.comparisonOptions && props.presentation.comparisonOptions.length > 0
      ? props.presentation.comparisonOptions.map((option) => option)
      : [...defaultComparisonOptions],
  );
  const comparison = () =>
    props.presentation.comparison ?? comparisonOptions()[0]?.value ?? "working";
  const selectedComparison = () =>
    comparisonOptions().find((option) => option.value === comparison()) ?? comparisonOptions()[0];

  const [expandedByPath, setExpandedByPath] = createSignal<ReadonlyMap<string, boolean>>(new Map());
  const fileExpanded = (file: DiffFileData) =>
    expandedByPath().get(file.file) ?? file.defaultExpanded ?? true;
  const setFileExpanded = (path: string, expanded: boolean) => {
    setExpandedByPath((current) => new Map(current).set(path, expanded));
  };
  const allCollapsed = createMemo(
    () => props.files.length > 0 && props.files.every((file) => !fileExpanded(file)),
  );
  const toggleAll = () => {
    const expanded = allCollapsed();
    setExpandedByPath(new Map(props.files.map((file) => [file.file, expanded])));
  };

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
                if (option) props.presentation.onComparisonChange?.(option.value);
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
            <IconButton
              class="diff-collapse-toggle oc-focus-inset"
              type="button"
              size="small"
              variant="ghost-muted"
              icon={<Icon name={allCollapsed() ? "expand" : "collapse"} size="small" />}
              aria-label={allCollapsed() ? "Expand all files" : "Collapse all files"}
              title={allCollapsed() ? "Expand all files" : "Collapse all files"}
              onClick={toggleAll}
            />
          </Show>
        </div>
      </Show>

      {/* Keep the error operand last so the accessor yields the message, not a boolean. */}
      <Show when={props.files.length === 0 && props.presentation.error}>
        {(error) => (
          <div class="context-state error-state" role="alert">
            <Icon aria-hidden="true" name="warning" size="small" />
            <p>{error()}</p>
            <Show when={props.presentation.onRetry}>
              <Button
                size="normal"
                variant="outline"
                type="button"
                onClick={() => props.presentation.onRetry?.()}
              >
                Retry
              </Button>
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={!props.presentation.error && props.presentation.loading && props.files.length === 0}
      >
        <output class="context-state loading-state">
          <Loader class="context-spinner" width="18" height="18" aria-hidden="true" />
          <span>Loading diff</span>
        </output>
      </Show>

      <Show
        when={!props.presentation.error && !props.presentation.loading && props.files.length === 0}
      >
        <div class="context-state empty-state">
          <p>{props.presentation.emptyMessage ?? "No working tree changes"}</p>
          <Show when={props.presentation.emptyDescription}>
            {(description) => <span>{description()}</span>}
          </Show>
        </div>
      </Show>

      <Show when={props.files.length > 0}>
        <>
          <Show when={props.presentation.loading}>
            <output class="diff-refresh-state">
              <Loader class="context-spinner" width="14" height="14" aria-hidden="true" />
              <span>Refreshing diff</span>
            </output>
          </Show>
          <Show when={props.presentation.error}>
            {(error) => (
              <div class="diff-refresh-state error-state" role="alert">
                <span>{error()}</span>
                <Show when={props.presentation.onRetry}>
                  <Button
                    size="normal"
                    variant="outline"
                    type="button"
                    onClick={() => props.presentation.onRetry?.()}
                  >
                    Retry
                  </Button>
                </Show>
              </div>
            )}
          </Show>
          <Show
            when={
              props.presentation.stale && !props.presentation.loading && !props.presentation.error
            }
          >
            <p class="diff-refresh-state">Showing cached changes</p>
          </Show>
          <DiffCodeView
            files={props.files}
            review={props.review}
            expanded={fileExpanded}
            onToggle={setFileExpanded}
          />
        </>
      </Show>
    </section>
  );
}
