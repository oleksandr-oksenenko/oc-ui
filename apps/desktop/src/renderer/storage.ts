import { Context, Deferred, Effect, Schema, Semaphore } from "effect";

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
export type StorageTransaction<A> = {
  readonly store: (name: string) => IDBObjectStore;
  readonly read: <T>(request: IDBRequest<T>, use: (value: T) => void) => void;
  readonly result: (value: A) => void;
};

/** Native requests stay inside the transaction; Effects resume only on settlement. */
export const makeStorage = Effect.fn("Storage.make")(function* (options: {
  readonly name: string;
  readonly version: number;
  readonly upgrade: (database: IDBDatabase) => void;
  readonly factory?: IDBFactory;
}) {
  let database: IDBDatabase | undefined;
  const opening = Semaphore.makeUnsafe(1);
  const failure = (cause: unknown) =>
    new StorageError({
      message: "Local storage is unavailable.",
      cause,
    });
  const open = Effect.fn("Storage.open")(function* () {
    if (database) return database;
    const value = yield* Effect.callback<IDBDatabase, StorageError>((resume) => {
      let cancelled = false;
      let request: IDBOpenDBRequest;
      try {
        request = (options.factory ?? globalThis.indexedDB).open(options.name, options.version);
      } catch (cause) {
        resume(Effect.fail(failure(cause)));
        return Effect.void;
      }
      request.addEventListener("upgradeneeded", () => {
        try {
          options.upgrade(request.result);
        } catch (cause) {
          request.transaction?.abort();
          resume(Effect.fail(failure(cause)));
        }
      });
      request.addEventListener("error", () => resume(Effect.fail(failure(request.error))));
      request.addEventListener("blocked", () => {
        cancelled = true;
        resume(
          Effect.fail(failure(new Error("Close other windows using an older database version."))),
        );
      });
      request.addEventListener("success", () => {
        const db = request.result;
        if (cancelled) {
          db.close();
          return;
        }
        db.addEventListener("versionchange", () => {
          db.close();
          if (database === db) database = undefined;
        });
        resume(Effect.succeed(db));
      });
      return Effect.sync(() => {
        cancelled = true;
      });
    });
    database = value;
    return value;
  }, Semaphore.withPermit(opening));
  yield* Effect.addFinalizer(() => Effect.sync(() => database?.close()));
  const transaction = <A>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    body: (transaction: StorageTransaction<A>) => void,
  ): Effect.Effect<A, StorageError> =>
    open().pipe(
      Effect.flatMap((db) =>
        Effect.callback<A, StorageError>((resume) => {
          let tx: IDBTransaction;
          try {
            tx = db.transaction([...stores], mode);
          } catch (cause) {
            resume(Effect.fail(failure(cause)));
            return Effect.void;
          }
          let value!: A;
          let caught: unknown;
          const settled = Deferred.makeUnsafe<void>();
          const guard = (work: () => void) => {
            try {
              work();
            } catch (cause) {
              caught = cause;
              tx.abort();
            }
          };
          tx.addEventListener("complete", () => {
            Deferred.doneUnsafe(settled, Effect.void);
            resume(Effect.succeed(value));
          });
          tx.addEventListener("abort", () => {
            Deferred.doneUnsafe(settled, Effect.void);
            resume(Effect.fail(failure(caught ?? tx.error)));
          });
          guard(() =>
            body({
              store: (name) => tx.objectStore(name),
              read: (request, use) => {
                request.addEventListener("success", () => guard(() => use(request.result)));
              },
              result: (next) => {
                value = next;
              },
            }),
          );
          return Effect.sync(() => {
            try {
              tx.abort();
            } catch {
              /* Already committed or aborted. */
            }
          }).pipe(Effect.andThen(Deferred.await(settled)));
        }),
      ),
    );
  return { transaction };
});
export class Storage extends Context.Service<
  Storage,
  Effect.Success<ReturnType<typeof makeStorage>>
>()("renderer/Storage") {}
