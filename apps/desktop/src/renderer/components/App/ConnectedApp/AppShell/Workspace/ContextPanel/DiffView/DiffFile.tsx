import { For, createSignal } from "solid-js";
import { Collapsible } from "@opencode-ai/ui/collapsible";
import { DiffChanges } from "@opencode-ai/ui/diff-changes";
import { Icon } from "@opencode-ai/ui/icon";

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
                        <Icon name="plus-small" size="small" />
                      ) : line.kind === "deletion" ? (
                        <Icon name="dash" size="small" />
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
        </Collapsible.Content>
      </Collapsible>
    </article>
  );
}
