import { For, Show } from "solid-js";
import { IconAlertCircle, IconLoader2 } from "@tabler/icons-solidjs";

import { DiffFile } from "./DiffView/DiffFile.tsx";
import type { DiffFileData } from "./DiffView/DiffFile.tsx";

export type DiffViewProps = {
  readonly files: readonly DiffFileData[];
  readonly loading: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly scope?: string;
  readonly scopeOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly onScopeChange?: (value: string) => void;
};

const defaultScopeOptions = [{ value: "all", label: "All changes" }] as const;

export function DiffView(props: DiffViewProps) {
  const additions = () => props.files.reduce((total, file) => total + file.additions, 0);
  const deletions = () => props.files.reduce((total, file) => total + file.deletions, 0);
  const scopeOptions = () =>
    props.scopeOptions && props.scopeOptions.length > 0 ? props.scopeOptions : defaultScopeOptions;
  const scope = () => props.scope ?? scopeOptions()[0]?.value ?? "all";

  return (
    <section class="context-view diff-view" aria-label="Diff">
      <Show when={props.error}>
        {(error) => (
          <div class="context-state error-state" role="alert">
            <IconAlertCircle aria-hidden="true" size="18" stroke="1.7" />
            <p>{error()}</p>
            <Show when={props.onRetry}>
              <button class="context-retry" type="button" onClick={() => props.onRetry?.()}>
                Retry
              </button>
            </Show>
          </div>
        )}
      </Show>

      <Show when={!props.error && props.loading && props.files.length === 0}>
        <output class="context-state loading-state">
          <IconLoader2 class="context-spinner" aria-hidden="true" size="18" stroke="1.7" />
          <span>Loading diff</span>
        </output>
      </Show>

      <Show when={!props.error && !props.loading && props.files.length === 0}>
        <div class="context-state empty-state">
          <p>No changes in this session</p>
        </div>
      </Show>

      <Show when={!props.error && props.files.length > 0}>
        <>
          <div class="diff-summary">
            <select
              aria-label="Diff scope"
              value={scope()}
              onChange={(event) => props.onScopeChange?.(event.currentTarget.value)}
            >
              <For each={scopeOptions()}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
            <span class="diff-summary-count">{props.files.length} files</span>
            <span class="diff-summary-additions">+{additions()}</span>
            <span class="diff-summary-deletions">−{deletions()}</span>
          </div>
          <div class="diff-file-list">
            <For each={props.files}>{(file) => <DiffFile file={file} />}</For>
          </div>
        </>
      </Show>
    </section>
  );
}
