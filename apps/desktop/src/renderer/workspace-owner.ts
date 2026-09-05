import { Context, Effect, Fiber, FiberMap, Option, Schema, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

export class WorkspaceRequestError extends Schema.TaggedError<WorkspaceRequestError>()(
  "WorkspaceRequestError",
  { cause: Schema.Defect() },
) {}

export type WorkspaceOwner = {
  readonly scope: Scope.Scope;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => A;
  readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly request: typeof workspaceRequest;
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void;
  readonly latest: <A = void, E = never>() => {
    readonly run: (effect: Effect.Effect<A, E, Scope.Scope>) => Fiber.Fiber<A, E>;
    readonly cancel: () => void;
  };
};

/** Cancel real I/O, then retain its owner until the SDK helper has settled. */
export const workspaceRequest = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.callback<A, WorkspaceRequestError>((resume, signal) => {
    let settled: Promise<void>;
    try {
      settled = operation(signal).then(
        (value) => resume(Effect.succeed(value)),
        (cause) => resume(Effect.fail(new WorkspaceRequestError({ cause }))),
      );
    } catch (cause) {
      resume(Effect.fail(new WorkspaceRequestError({ cause })));
      return Effect.void;
    }
    return Effect.promise(() => settled);
  });

/** Bind framework callbacks to the lifetime supplied by the connection or workspace. */
export const makeWorkspaceOwner = Effect.fn("makeWorkspaceOwner")(function* (
  registry: AtomRegistry.AtomRegistry,
): Effect.fn.Return<WorkspaceOwner, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const context = Context.add(yield* Effect.context(), Scope.Scope, scope);
  const run = Effect.runSyncWith(context);
  const runSync = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): A =>
    run(scope.state._tag === "Closed" ? Effect.interrupt : effect);
  const runPromise = Effect.runPromiseWith(context);
  const latestReads = runSync(FiberMap.make<symbol>());
  const runFork = <A, E>(effect: Effect.Effect<A, E>) =>
    run(
      Effect.forkScoped(scope.state._tag === "Closed" ? Effect.interrupt : effect, {
        startImmediately: true,
      }),
    );
  return {
    scope,
    registry,
    runSync,
    request: workspaceRequest,
    runFork,
    runPromise: (effect) => runPromise(Fiber.join(runFork(effect))),
    mount: (atom) => {
      const lifetime = runFork(
        Effect.acquireRelease(
          Effect.sync(() => registry.mount(atom)),
          (release) => Effect.sync(release),
        ).pipe(Effect.andThen(Effect.never), Effect.scoped),
      );
      return () => lifetime.interruptUnsafe();
    },
    latest: <A = void, E = never>() => {
      const key = Symbol();
      return {
        run: (effect: Effect.Effect<A, E, Scope.Scope>) => {
          // The map selects the current read; the workspace retains replaced I/O.
          Option.getOrUndefined(FiberMap.getUnsafe(latestReads, key))?.interruptUnsafe();
          const fiber = runFork(Effect.scoped(effect));
          FiberMap.setUnsafe(latestReads, key, fiber);
          return fiber;
        },
        cancel: () => {
          runFork(FiberMap.remove(latestReads, key));
        },
      };
    },
  };
});
