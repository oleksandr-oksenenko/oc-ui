import { Context, Effect, Fiber, Layer, ManagedRuntime, ScopedRef } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { RegistryContext } from "@effect/atom-solid";
import { createComponent, createRoot, getOwner, runWithOwner, untrack } from "solid-js";

import type { DesktopApi, OpenCodeTarget } from "../shared/desktop-api.ts";
import { OpenCodeConnectionError, verifyServer } from "./opencode/index.ts";
import type { VerifiedServer } from "./opencode/index.ts";
import { createConnectedRuntime, type ConnectedRuntime } from "./opencode/runtime.ts";
import { makeWorkspaceOwner, WorkspaceRequestError } from "./workspace-owner.ts";

import {
  createWorkspaceModel,
  type WorkspaceModel,
} from "./components/App/ConnectedApp/createWorkspace.ts";

type Mode = "local" | "remote";
type SavedTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly serverUrl: string };
type ConnectionState = {
  readonly mode: Mode;
  readonly serverUrl: string;
  readonly password: string;
  readonly savedTarget?: SavedTarget;
  readonly owner?: Mode;
  readonly workspace?: {
    readonly server: VerifiedServer;
    readonly runtime: ConnectedRuntime;
    readonly model: WorkspaceModel;
  };
  readonly status: "disconnected" | "connecting" | "connected" | "failed";
  readonly error?: string;
  readonly localUnavailable: boolean;
};

const makeConnection = Effect.fn("Connection.make")(function* (
  desktop: DesktopApi,
  registry: AtomRegistry.AtomRegistry,
) {
  const effects = yield* makeWorkspaceOwner(registry);
  const state = Atom.make<ConnectionState>({
    mode: "local",
    serverUrl: "",
    password: "",
    status: "disconnected",
    localUnavailable: false,
  });
  effects.mount(state);
  const get = () => registry.get(state);
  const update = (patch: Partial<ConnectionState>) =>
    registry.update(state, (value) => ({ ...value, ...patch }));
  let savedPassword = "";
  let operation: Fiber.Fiber<void> | undefined;
  const workspace = effects.runSync(
    ScopedRef.make<ConnectionState["workspace"] | void>(() => undefined),
  );

  const leave = Effect.fn("Connection.leave")(function* () {
    update({ workspace: undefined });
    yield* ScopedRef.set(workspace, Effect.void);
  });
  const replace = (work: Effect.Effect<void>) => {
    const previous = operation;
    if (previous) effects.runFork(Fiber.interrupt(previous));
    // Preserve the chain even if another selection supersedes this waiting transition.
    operation = effects.runFork(
      previous ? Fiber.await(previous).pipe(Effect.uninterruptible, Effect.andThen(work)) : work,
    );
  };
  const failure = (cause: unknown, local = false) => {
    const error =
      cause instanceof OpenCodeConnectionError
        ? cause.message
        : local
          ? "The built-in OpenCode server is unavailable. Retry to start it again, or connect to a remote server."
          : "The OpenCode server connection could not be set up. Check the address and try again.";
    update({ owner: undefined, status: "failed", error });
  };

  const connect = (
    mode: Mode,
    remote = { serverUrl: get().serverUrl, password: get().password || savedPassword },
  ) => {
    update({
      mode,
      owner: mode,
      status: "connecting",
      error: undefined,
      localUnavailable: mode === "local" ? false : get().localUnavailable,
    });
    replace(
      Effect.gen(function* () {
        yield* leave();
        let input = remote;
        if (mode === "local") {
          const local = yield* effects.request(() => desktop.localOpenCode.connect());
          if (local.status === "failed") {
            update({ status: "failed", error: local.message });
            return;
          }
          input = local.connection;
        }
        const server = yield* verifyServer(input);
        yield* ScopedRef.set(
          workspace,
          Effect.gen(function* () {
            const root = yield* Effect.acquireRelease(
              Effect.sync(() => createRoot((dispose) => ({ dispose, owner: getOwner()! }), null)),
              (acquired) => Effect.sync(acquired.dispose),
            );
            // Acquire after the Solid root so requests settle before the store is disposed.
            const owner = yield* makeWorkspaceOwner(registry);
            let runtime!: ConnectedRuntime;
            let model!: WorkspaceModel;
            runWithOwner(root.owner, () =>
              createComponent(RegistryContext.Provider, {
                value: registry,
                get children() {
                  untrack(() => {
                    runtime = createConnectedRuntime({
                      api: server.api,
                      defaultLocation: server.location,
                      effects: owner,
                    });
                    model = createWorkspaceModel(runtime);
                  });
                  return undefined;
                },
              }),
            );
            return { server, runtime, model };
          }),
        );
        const connected = yield* ScopedRef.get(workspace);
        if (!connected) return;
        update({ serverUrl: server.serverUrl, workspace: connected });
        yield* Effect.tryPromise({
          try: () => connected.runtime.ready,
          catch: (cause) => new WorkspaceRequestError({ cause }),
        });
        update({ status: "connected", password: "" });
        // Main owns accepted persistence. Interruption retains its settlement and suppresses late UI results.
        if (mode === "local") {
          yield* effects
            .request(() => desktop.target.saveLocal())
            .pipe(
              Effect.tap(() => Effect.sync(() => update({ savedTarget: { kind: "local" } }))),
              Effect.ignore,
            );
        } else {
          const target =
            input.password.length === 0
              ? { serverUrl: server.serverUrl }
              : { serverUrl: server.serverUrl, password: input.password };
          yield* effects
            .request(() => desktop.target.saveRemote(target))
            .pipe(
              Effect.tap(() =>
                Effect.sync(() =>
                  update({ savedTarget: { kind: "remote", serverUrl: server.serverUrl } }),
                ),
              ),
              Effect.ignore,
            );
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            failure(
              error instanceof OpenCodeConnectionError ? error : error.cause,
              mode === "local",
            );
            yield* leave();
          }),
        ),
      ),
    );
  };
  const changeServer = () => {
    const old = get();
    savedPassword = "";
    update({
      owner: undefined,
      status: "disconnected",
      password: "",
      error: undefined,
      mode: old.owner ?? old.savedTarget?.kind ?? "local",
      serverUrl: old.owner === "local" ? "" : old.serverUrl,
    });
    replace(leave());
  };
  const forget = () => {
    savedPassword = "";
    update({ owner: undefined, password: "", status: "disconnected", error: undefined });
    replace(
      Effect.gen(function* () {
        yield* leave();
        yield* effects.request(() => desktop.target.clear());
        update({ savedTarget: undefined, mode: "local", serverUrl: "" });
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() =>
            update({
              status: "failed",
              error: "The saved connection could not be forgotten. Retry before continuing.",
            }),
          ),
        ),
      ),
    );
  };
  const setMode = (mode: Mode) => {
    const old = get();
    update({
      mode,
      owner: undefined,
      status: "disconnected",
      error: undefined,
      serverUrl:
        mode === "remote" && !old.serverUrl && old.savedTarget?.kind === "remote"
          ? old.savedTarget.serverUrl
          : old.serverUrl,
    });
    replace(leave());
  };
  const unsubscribe = desktop.localOpenCode.onUnavailable(() => {
    update({ localUnavailable: true });
    if (get().owner === "local") changeServer();
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribe();
      savedPassword = "";
    }),
  );
  replace(
    effects
      .request(() => desktop.target.load())
      .pipe(
        Effect.flatMap((loaded: OpenCodeTarget | undefined) =>
          Effect.sync(() => {
            if (!loaded) return;
            update({
              savedTarget:
                loaded.kind === "local" ? loaded : { kind: "remote", serverUrl: loaded.serverUrl },
              mode: loaded.kind,
            });
            if (loaded.kind !== "remote") return;
            update({ serverUrl: loaded.serverUrl });
            if (loaded.password === undefined) return;
            savedPassword = loaded.password;
            connect("remote", { serverUrl: loaded.serverUrl, password: loaded.password });
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            update({
              status: "failed",
              error:
                "Saved connection settings could not be loaded. You can still connect manually.",
            }),
          ),
        ),
      ),
  );
  return {
    state,
    connect,
    changeServer,
    forget,
    setMode,
    setServerUrl: (serverUrl: string) => {
      savedPassword = "";
      update({ serverUrl });
    },
    setPassword: (password: string) => update({ password }),
  };
});

class Connection extends Context.Service<
  Connection,
  Effect.Success<ReturnType<typeof makeConnection>>
>()("renderer/Connection") {}

/** One runtime and registry per window, composed before rendering views. */
export function createRenderer(desktop: DesktopApi) {
  const registry = AtomRegistry.make();
  const runtime = ManagedRuntime.make(Layer.effect(Connection, makeConnection(desktop, registry)));
  const connection = runtime.runSync(Connection);
  let closing: Promise<void> | undefined;
  return {
    registry,
    connection,
    dispose: () =>
      (closing ??= Effect.runPromise(runtime.disposeEffect.pipe(Effect.uninterruptible)).finally(
        () => registry.dispose(),
      )),
  };
}
export type Renderer = ReturnType<typeof createRenderer>;
