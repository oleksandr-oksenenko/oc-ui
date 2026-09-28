import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import type { HighlightTokens } from "#renderer/syntax-highlight.ts";
import { useSyntaxHighlight } from "#renderer/ui/SyntaxHighlightProvider.tsx";
import { useTheme } from "#renderer/ui/ThemeProvider.tsx";
import { CopyCode } from "./TranscriptCodeBlock/CopyCode.tsx";

export function TranscriptCodeBlock(props: { code: string; language: string }) {
  const highlight = useSyntaxHighlight();
  const { theme } = useTheme();
  const [tokens, setTokens] = createSignal<HighlightTokens>();
  createEffect(() => {
    const input = { code: props.code, language: props.language, theme: theme() };
    const abort = new AbortController();
    setTokens(undefined);
    onCleanup(() => abort.abort());
    if (!highlight) return;
    void highlight(input, abort.signal).then(
      (result) => {
        if (!abort.signal.aborted) setTokens(result);
        return undefined;
      },
      (error) => {
        // oxlint-disable-next-line effecttsgo/global-console -- Last-resort reporting at the Solid/Promise boundary; service failures are logged in Effect.
        if (!abort.signal.aborted) console.error("Syntax highlighting failed", error);
        return undefined;
      },
    );
  });
  const separators = createMemo(() => props.code.match(/\r\n|\n|\r/g) ?? []);
  return (
    <>
      {/* Scrollable code must remain reachable by keyboard. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <pre tabIndex={0}>
        <code>
          <Show when={tokens()} fallback={props.code}>
            {(lines) => (
              <For each={lines()}>
                {(line, index) => (
                  <>
                    <For each={line}>
                      {(token) => (
                        <span
                          style={{
                            color: token.color,
                            "font-style": (token.fontStyle ?? 0) & 1 ? "italic" : undefined,
                            "font-weight": (token.fontStyle ?? 0) & 2 ? "bold" : undefined,
                            "text-decoration": (token.fontStyle ?? 0) & 4 ? "underline" : undefined,
                          }}
                        >
                          {token.content}
                        </span>
                      )}
                    </For>
                    {separators()[index()]}
                  </>
                )}
              </For>
            )}
          </Show>
        </code>
      </pre>
      <CopyCode text={props.code} />
    </>
  );
}
