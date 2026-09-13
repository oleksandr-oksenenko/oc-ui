import { Context, Effect, Fiber, Layer, ManagedRuntime, ScopedRef } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { RegistryContext } from "@effect/atom-solid";
import { createComponent, createRoot, getOwner, runWithOwner, untrack } from "solid-js";

import type { OpenCodeTarget } from "../shared/desktop-api.ts";
import type { AppHost } from "../shared/app-host.ts";
import { Appearance, makeAppearance, type Theme } from "./appearance.ts";
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
  readonly notice?: string;
  readonly localUnavailable: boolean;
};

const makeConnection = Effect.fn("Connection.make")(function* (
  host: AppHost,
  registry: AtomRegistry.AtomRegistry,
) {
  const effects = yield* makeWorkspaceOwner(registry);
  const desktop = host.kind === "desktop" ? host : undefined;
  const defaultMode = desktop ? "local" : "remote";
  const state = Atom.make<ConnectionState>({
    mode: defaultMode,
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
    if (mode === "local" && !desktop) return;
    update({
      mode,
      owner: mode,
      status: "connecting",
      error: undefined,
      notice: undefined,
      localUnavailable: mode === "local" ? false : get().localUnavailable,
    });
    replace(
      Effect.gen(function* () {
        yield* leave();
        let input = remote;
        if (mode === "local" && desktop) {
          const local = yield* effects.request(() => desktop.localOpenCode.connect());
          if (local.status === "failed") {
            update({ status: "failed", error: local.message });
            return;
          }
          input = local.connection;
        }
        const server = yield* verifyServer(
          input,
          host.kind === "browser" ? window.location.origin : undefined,
        );
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
                    model = createWorkspaceModel(
                      runtime,
                      desktop?.browser
                        ? {
                            api: desktop.browser,
                            serverUrl: server.serverUrl,
                            password: input.password,
                          }
                        : undefined,
                    );
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
        // The host owns accepted persistence; keep its settlement and suppress late UI results.
        const savedTarget: SavedTarget =
          mode === "local" ? { kind: "local" } : { kind: "remote", serverUrl: server.serverUrl };
        const target =
          input.password.length === 0
            ? { serverUrl: server.serverUrl }
            : { serverUrl: server.serverUrl, password: input.password };
        const save =
          mode === "local" && desktop
            ? effects.request(() => desktop.target.saveLocal())
            : effects.request(() => host.target.saveRemote(target)).pipe(Effect.asVoid);
        yield* save.pipe(
          Effect.tap(() => Effect.sync(() => update({ savedTarget }))),
          Effect.catch(() =>
            Effect.sync(() =>
              update({ notice: "The connection works, but its settings could not be saved." }),
            ),
          ),
        );
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
      mode: old.owner ?? old.savedTarget?.kind ?? defaultMode,
      serverUrl: old.owner === "local" ? "" : old.serverUrl,
    });
    replace(leave());
  };
  const forget = () => {
    savedPassword = "";
    update({
      owner: undefined,
      password: "",
      status: "disconnected",
      error: undefined,
      notice: undefined,
    });
    replace(
      Effect.gen(function* () {
        yield* leave();
        yield* effects.request(() => host.target.clear());
        update({ savedTarget: undefined, mode: defaultMode, serverUrl: "" });
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
    if (mode === "local" && !desktop) return;
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
  const unsubscribe = desktop?.localOpenCode.onUnavailable(() => {
    update({ localUnavailable: true });
    if (get().owner === "local") changeServer();
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribe?.();
      savedPassword = "";
    }),
  );
  replace(
    effects
      .request<OpenCodeTarget | undefined>(() => host.target.load())
      .pipe(
        Effect.flatMap((loaded: OpenCodeTarget | undefined) =>
          Effect.sync(() => {
            if (!loaded) return;
            if (loaded.kind === "local" && !desktop) return;
            update({
              savedTarget:
                loaded.kind === "local" ? loaded : { kind: "remote", serverUrl: loaded.serverUrl },
              mode: loaded.kind,
            });
            if (loaded.kind !== "remote") return;
            update({ serverUrl: loaded.serverUrl });
            if (!desktop || loaded.password === undefined) return;
            savedPassword = loaded.password;
            connect("remote", { serverUrl: loaded.serverUrl, password: loaded.password });
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            update({
              notice:
                "Saved connection settings could not be loaded. You can still connect manually.",
            }),
          ),
        ),
      ),
  );
  return {
    state,
    builtInAvailable: desktop !== undefined,
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
export function createRenderer(host: AppHost) {
  const registry = AtomRegistry.make();
  const runtime = ManagedRuntime.make(
    Layer.merge(
      Layer.effect(Connection, makeConnection(host, registry)),
      Layer.effect(Appearance, makeAppearance(registry)),
    ),
  );
  const connection = runtime.runSync(Connection);
  const appearance = runtime.runSync(Appearance);
  let closing: Promise<void> | undefined;
  return {
    registry,
    connection,
    appearance: {
      state: appearance.state,
      setTheme: (theme: Theme) => {
        if (!closing) runtime.runSync(appearance.setTheme(theme));
      },
    },
    dispose: () =>
      (closing ??= Effect.runPromise(runtime.disposeEffect.pipe(Effect.uninterruptible)).finally(
        () => registry.dispose(),
      )),
  };
}
export type Renderer = ReturnType<typeof createRenderer>;
