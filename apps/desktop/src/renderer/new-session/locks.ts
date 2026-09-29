import { Effect, Exit, Schema } from "effect";

export class DraftLockError extends Schema.TaggedError<DraftLockError>()("DraftLockError", {
  message: Schema.String,
}) {}
export const draftLockName = (serverKey: string, id: string) =>
  JSON.stringify(["ocui-draft", serverKey, id]);

/** The native callback retains the lock until the Effect and its finalizers settle. */
export const withBrowserLock = <A, E>(
  name: string,
  work: Effect.Effect<A, E>,
  ifAvailable = false,
) =>
  Effect.gen(function* () {
    if (!navigator.locks)
      return yield* new DraftLockError({
        message: "This browser cannot safely submit saved drafts (Web Locks unavailable).",
      });
    const context = yield* Effect.context();
    const run = Effect.runPromiseExitWith(context);
    const result = yield* Effect.callback<Exit.Exit<A, E | DraftLockError>, DraftLockError>(
      (resume, signal) => {
        const pending = navigator.locks
          .request(name, ifAvailable ? { ifAvailable: true } : { signal }, (lock) =>
            lock
              ? run(work, { signal })
              : Exit.fail(
                  new DraftLockError({
                    message: "This draft is being submitted in another window.",
                  }),
                ),
          )
          .then(
            (exit) => resume(Effect.succeed(exit)),
            () =>
              resume(
                Effect.fail(
                  new DraftLockError({ message: "The draft lock could not be acquired." }),
                ),
              ),
          );
        return Effect.promise(() => pending);
      },
    );
    return yield* result;
  });
