import { For, Show, createSignal } from "solid-js";
import { IconChevronDown, IconChevronRight, IconMinus, IconPlus } from "@tabler/icons-solidjs";

type DiffLineKind = "context" | "addition" | "deletion";

type DiffLine = {
  readonly kind: DiffLineKind;
  readonly content: string;
  readonly oldLine?: number;
  readonly newLine?: number;
};

export type DiffFileData = {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: readonly DiffLine[];
  readonly defaultExpanded?: boolean;
};

export type DiffFileProps = {
  readonly file: DiffFileData;
};

export function DiffFile(props: DiffFileProps) {
  const [expanded, setExpanded] = createSignal(props.file.defaultExpanded ?? true);

  return (
    <article class="diff-file">
      <header class="diff-file-header">
        <button
          class="diff-file-toggle"
          type="button"
          aria-expanded={expanded()}
          aria-label={`${expanded() ? "Collapse" : "Expand"} ${props.file.path}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span class="diff-file-name">
            <Show
              when={expanded()}
              fallback={<IconChevronRight aria-hidden="true" size="14" stroke="1.8" />}
            >
              <IconChevronDown aria-hidden="true" size="14" stroke="1.8" />
            </Show>
            <span title={props.file.path}>{props.file.path}</span>
          </span>
        </button>
        <span
          class="diff-file-stats"
          aria-label={`${props.file.additions} additions, ${props.file.deletions} deletions`}
        >
          <Show when={props.file.additions > 0}>
            <span class="diff-stat additions">
              <IconPlus aria-hidden="true" size="10" stroke="1.8" />
              {props.file.additions}
            </span>
          </Show>
          <Show when={props.file.deletions > 0}>
            <span class="diff-stat deletions">
              <IconMinus aria-hidden="true" size="10" stroke="1.8" />
              {props.file.deletions}
            </span>
          </Show>
        </span>
      </header>

      <Show when={expanded()}>
        <table class="diff-lines" aria-label={`Changes in ${props.file.path}`}>
          <tbody>
            <For each={props.file.lines}>
              {(line) => (
                <tr class={`diff-line ${line.kind}`}>
                  <td class="diff-line-number old" aria-hidden="true">
                    {line.oldLine ?? ""}
                  </td>
                  <td class="diff-line-number new" aria-hidden="true">
                    {line.newLine ?? ""}
                  </td>
                  <td class="diff-line-marker" aria-hidden="true">
                    {line.kind === "addition" ? (
                      <IconPlus size="11" stroke="1.8" />
                    ) : line.kind === "deletion" ? (
                      <IconMinus size="11" stroke="1.8" />
                    ) : null}
                  </td>
                  <td>
                    <code class="diff-line-content">{line.content || " "}</code>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </article>
  );
}
