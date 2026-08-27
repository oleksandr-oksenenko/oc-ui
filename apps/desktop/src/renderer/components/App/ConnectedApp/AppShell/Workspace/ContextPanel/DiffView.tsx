import { For, Show } from "solid-js";
import { Button } from "@opencode-ai/ui/button";
import { DiffChanges } from "@opencode-ai/ui/diff-changes";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";

import { DiffFile } from "./DiffView/DiffFile.tsx";
import type { DiffFileData } from "./DiffView/DiffFile.tsx";

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
};

const defaultComparisonOptions = [{ value: "working", label: "Working changes" }] as const;

export function DiffView(props: DiffViewProps) {
  const additions = () => props.files.reduce((total, file) => total + file.additions, 0);
  const deletions = () => props.files.reduce((total, file) => total + file.deletions, 0);
  const comparisonOptions = (): { readonly value: string; readonly label: string }[] =>
    props.comparisonOptions && props.comparisonOptions.length > 0
      ? props.comparisonOptions.map((option) => option)
      : [...defaultComparisonOptions];
  const comparison = () => props.comparison ?? comparisonOptions()[0]?.value ?? "working";

  return (
    <section class="context-view diff-view" aria-label="Diff">
      <Show when={props.files.length > 0 || comparisonOptions().length > 1}>
        <div class="diff-summary">
          <Show when={comparisonOptions().length > 1}>
            <select
              class="diff-comparison-select"
              aria-label="Diff comparison"
              value={comparison()}
              onChange={(event) => props.onComparisonChange?.(event.currentTarget.value)}
            >
              <For each={comparisonOptions()}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
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
                class="context-retry"
                size="small"
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
                    class="context-retry"
                    size="small"
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
            <For each={props.files}>{(file) => <DiffFile file={file} />}</For>
          </div>
        </>
      </Show>
    </section>
  );
}
