/* oxlint-disable unicorn/require-post-message-target-origin -- This entry runs in a dedicated worker, not a Window. */
import { Effect, Schema, Scope, Stream } from "effect";

import { HighlightSnippet } from "./syntax-highlight-protocol.ts";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This worker entry is the composition root for its scoped tokenizer.
import { makeSyntaxTokenizer } from "./syntax-tokenizer.ts";

// One request per borrowed worker. Cancellation terminates the worker's VM,
// including non-abortable grammar loads and synchronous tokenization.
Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      // Install the message listener before awaiting Shiki's initialization.
      const tokenizer = yield* Effect.cached(makeSyntaxTokenizer().pipe(Scope.provide(scope)));
      yield* Stream.fromEventListener<MessageEvent<unknown>>(self, "message").pipe(
        Stream.runForEach((event) =>
          Schema.decodeUnknownEffect(HighlightSnippet)(event.data).pipe(
            Effect.flatMap((input) =>
              Effect.flatMap(tokenizer, (service) => service.highlight(input)),
            ),
            Effect.flatMap((tokens) => Effect.sync(() => self.postMessage({ tokens }))),
            Effect.catch((error) => Effect.sync(() => self.postMessage({ error: String(error) }))),
          ),
        ),
      );
    }),
  ),
);
