import { Cache, Context, Effect, Exit, Layer, Pool, Schema } from "effect";
import { bundledLanguagesInfo } from "shiki/langs";

import {
  HighlightResponse,
  SyntaxHighlightError,
  type HighlightSnippet,
  type HighlightTokens,
} from "./syntax-highlight-protocol.ts";

export type { HighlightSnippet, HighlightTokens } from "./syntax-highlight-protocol.ts";

const languages = new Map<string, string>();
for (const language of bundledLanguagesInfo) {
  languages.set(language.id, language.id);
  for (const alias of language.aliases ?? []) languages.set(alias, language.id);
}
export const MAX_HIGHLIGHT_LENGTH = 8 * 1024;
const MAX_CACHE_ENTRIES = 32;

export const makeSyntaxHighlight = Effect.fn("SyntaxHighlight.make")(function* (
  createWorker: () => Worker = () =>
    new Worker(new URL("./syntax-highlight.worker.ts", import.meta.url), {
      type: "module",
    }),
) {
  const pool = yield* Pool.makeWithTTL({
    acquire: Effect.acquireRelease(
      Effect.try({ try: createWorker, catch: (cause) => new SyntaxHighlightError({ cause }) }),
      (worker) => Effect.sync(() => worker.terminate()),
    ),
    min: 0,
    max: 2,
    concurrency: 1,
    timeToLive: "5 minutes",
  });

  const cache = yield* Cache.makeWith(
    (input: HighlightSnippet) =>
      Pool.use(pool, (worker) =>
        Effect.callback<HighlightTokens, SyntaxHighlightError>((resume) => {
          const fail = (cause: unknown) => resume(Effect.fail(new SyntaxHighlightError({ cause })));
          const onMessage = (event: MessageEvent<unknown>) =>
            resume(
              Schema.decodeUnknownEffect(HighlightResponse)(event.data).pipe(
                Effect.mapError((cause) => new SyntaxHighlightError({ cause })),
                Effect.flatMap((response) =>
                  "tokens" in response
                    ? Effect.succeed(response.tokens)
                    : Effect.fail(new SyntaxHighlightError({ cause: response.error })),
                ),
              ),
            );
          const onError = (event: ErrorEvent) => fail(event.error ?? event.message);
          const onMessageError = () => fail("Worker response could not be decoded");
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.addEventListener("messageerror", onMessageError);
          try {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated workers do not have a target origin.
            worker.postMessage(input);
          } catch (cause) {
            fail(cause);
          }
          return Effect.sync(() => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            worker.removeEventListener("messageerror", onMessageError);
          });
        }).pipe(
          Effect.timeout("10 seconds"),
          Effect.catchTag("TimeoutError", (cause) =>
            Effect.fail(new SyntaxHighlightError({ cause })),
          ),
          // Terminate failed or interrupted work before this slot can be borrowed again.
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Pool.invalidate(pool, worker) : Effect.void,
          ),
        ),
      ).pipe(Effect.scoped),
    {
      capacity: MAX_CACHE_ENTRIES,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
    },
  );
  yield* Effect.addFinalizer(() => Cache.invalidateAll(cache));

  const highlight = Effect.fn("SyntaxHighlight.highlight")(function* (input: HighlightSnippet) {
    const language = languages.get(input.language.toLowerCase());
    if (
      !input.code ||
      input.code.length > MAX_HIGHLIGHT_LENGTH ||
      language === undefined ||
      input.code.split(/\r\n|\n|\r/).some((line) => line.length > 2000)
    )
      return undefined;
    return yield* Cache.get(cache, { code: input.code, language, theme: input.theme });
  });
  return { highlight };
});

export class SyntaxHighlight extends Context.Service<
  SyntaxHighlight,
  Effect.Success<ReturnType<typeof makeSyntaxHighlight>>
>()("renderer/SyntaxHighlight") {
  static readonly layer = Layer.effect(SyntaxHighlight, makeSyntaxHighlight());
}
