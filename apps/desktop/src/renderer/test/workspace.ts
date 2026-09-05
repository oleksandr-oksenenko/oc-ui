import { RegistryContext } from "@effect/atom-solid";
import { Effect, Exit, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createComponent, createRoot, untrack } from "solid-js";
import { afterEach } from "vite-plus/test";

import { makeWorkspaceOwner, type WorkspaceOwner } from "../workspace-owner.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A real workspace scope and atom registry, shared by the controller and its Solid reads. */
export function withTestWorkspace<A>(
  build: (effects: WorkspaceOwner, dispose: () => void) => A,
): A {
  const scope = Scope.makeUnsafe();
  const registry = AtomRegistry.make();
  const effects = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  let result!: A;
  createRoot((disposeRoot) => {
    let closing: Promise<void> | undefined;
    const cleanup = () => {
      disposeRoot();
      return (closing ??= Effect.runPromise(Scope.close(scope, Exit.void)).finally(() =>
        registry.dispose(),
      ));
    };
    cleanups.push(cleanup);
    createComponent(RegistryContext.Provider, {
      value: registry,
      get children() {
        result = untrack(() => build(effects, disposeRoot));
        return undefined;
      },
    });
  });
  return result;
}
