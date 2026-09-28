import { createContext, useContext, type ParentProps } from "solid-js";

import type { HighlightSnippet, HighlightTokens } from "../syntax-highlight.ts";

export type HighlightCode = (
  input: HighlightSnippet,
  signal: AbortSignal,
) => Promise<HighlightTokens | undefined>;

const SyntaxHighlightContext = createContext<HighlightCode>();
export const useSyntaxHighlight = () => useContext(SyntaxHighlightContext);

export function SyntaxHighlightProvider(props: ParentProps<{ highlight: HighlightCode }>) {
  return (
    <SyntaxHighlightContext.Provider value={props.highlight}>
      {props.children}
    </SyntaxHighlightContext.Provider>
  );
}
