import { Effect, Exit, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { deferred } from "./test/deferred.ts";
import { makeWorkspaceOwner } from "./workspace-owner.ts";

const setup = () => {
  const scope = Scope.makeUnsafe();
  const registry = AtomRegistry.make();
  const owner = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return {
    owner,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)).finally(() => registry.dispose()),
  };
};

describe("Workspace lifetime", () => {
  it("aborts requests and waits for helper settlement before disposing the SDK root", async () => {
    const { owner, close } = setup();
    const helper = deferred();
    let signal: AbortSignal | undefined;
    let disposed = false;
    Effect.runSync(
      Scope.addFinalizer(
        owner.scope,
        Effect.sync(() => {
          disposed = true;
        }),
      ),
    );
    const running = owner.runPromise(
      owner.request((requestSignal) => {
        signal = requestSignal;
        return helper.promise;
      }),
    );
    const settled = running.catch(() => undefined);
    const closing = close();
    expect(signal?.aborted).toBe(true);
    expect(disposed).toBe(false);
    helper.resolve();
    await closing;
    await settled;
    expect(disposed).toBe(true);
  });

  it("keeps atom state and accepted work after its last subscriber leaves", async () => {
    const { owner, close } = setup();
    const state = Atom.make(0);
    owner.mount(state);
    const unsubscribe = owner.registry.subscribe(state, () => {});
    const helper = deferred<number>();
    const running = owner.runPromise(
      owner
        .request(() => helper.promise)
        .pipe(Effect.tap((value) => Effect.sync(() => owner.registry.set(state, value)))),
    );
    unsubscribe();
    helper.resolve(7);
    await running;
    expect(owner.registry.get(state)).toBe(7);
    await close();
  });
  it("rejects new work after closure before starting its I/O", async () => {
    const { owner, close } = setup();
    await close();
    let started = false;
    await expect(
      owner.runPromise(
        owner.request(() => {
          started = true;
          return Promise.resolve();
        }),
      ),
    ).rejects.toBeDefined();
    expect(started).toBe(false);
  });
});
