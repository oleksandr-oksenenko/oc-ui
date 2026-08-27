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
  readonly scope?: string;
  readonly scopeOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly onScopeChange?: (value: string) => void;
};

const defaultScopeOptions = [{ value: "all", label: "All changes" }] as const;

export function DiffView(props: DiffViewProps) {
  const additions = () => props.files.reduce((total, file) => total + file.additions, 0);
  const deletions = () => props.files.reduce((total, file) => total + file.deletions, 0);
  const scopeOptions = (): { readonly value: string; readonly label: string }[] =>
    props.scopeOptions && props.scopeOptions.length > 0
      ? props.scopeOptions.map((option) => option)
      : [...defaultScopeOptions];
  const scope = () => props.scope ?? scopeOptions()[0]?.value ?? "all";

  return (
    <section class="context-view diff-view" aria-label="Diff">
      <Show when={props.error}>
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
          <p>{props.emptyMessage ?? "No changes in this session"}</p>
          <Show when={props.emptyDescription}>{(description) => <span>{description()}</span>}</Show>
        </div>
      </Show>

      <Show when={!props.error && props.files.length > 0}>
        <>
          <div class="diff-summary">
            <select
              class="diff-scope-select"
              aria-label="Diff scope"
              value={scope()}
              onChange={(event) => props.onScopeChange?.(event.currentTarget.value)}
            >
              <For each={scopeOptions()}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
            <span class="diff-summary-count">{props.files.length} files</span>
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
          </div>
          <div class="diff-file-list">
            <For each={props.files}>{(file) => <DiffFile file={file} />}</For>
          </div>
        </>
      </Show>
    </section>
  );
}
