import { Effect } from "effect";
import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

import { activeSyntaxTheme, syntaxThemes } from "./syntax-theme.ts";
import { SyntaxHighlightError, type HighlightSnippet } from "./syntax-highlight-protocol.ts";

// The worker processes requests sequentially; the pool owns cancellation by termination.
export const makeSyntaxTokenizer = Effect.fn("SyntaxTokenizer.make")(function* (
  create: () => Promise<Highlighter> = () =>
    createHighlighter({ themes: Object.values(syntaxThemes), langs: [] }),
) {
  const instance = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: create, catch: (cause) => new SyntaxHighlightError({ cause }) }),
    (highlighter) => Effect.sync(() => highlighter.dispose()),
  );
  const highlight = Effect.fn("SyntaxTokenizer.highlight")(function* (input: HighlightSnippet) {
    // SAFETY: The renderer resolves language IDs against Shiki's bundled registry before dispatch.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const language = input.language as BundledLanguage;
    if (!instance.getLoadedLanguages().includes(language))
      yield* Effect.tryPromise({
        try: () => instance.loadLanguage(language),
        catch: (cause) => new SyntaxHighlightError({ cause }),
      });
    return instance.codeToTokens(input.code, {
      lang: language,
      theme: activeSyntaxTheme(input.theme),
    }).tokens;
  });
  return { highlight };
});
