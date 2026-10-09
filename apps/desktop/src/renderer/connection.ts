import { Context, Effect, Fiber, Layer, ManagedRuntime, ScopedRef } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { RegistryContext } from "@effect/atom-solid";
import { createComponent, createRoot, getOwner, runWithOwner, untrack } from "solid-js";
import type { WorkerPoolManager } from "@pierre/diffs/worker";

import type { OpenCodeTarget } from "../shared/desktop-api.ts";
import type { AppHost } from "../shared/app-host.ts";
import { Storage, makeStorage } from "./storage.ts";
import { NewSessionDrafts, makeNewSessionDrafts, draftDatabase } from "./new-session/drafts.ts";
import { SyntaxHighlight, type HighlightSnippet } from "./syntax-highlight.ts";
import { Appearance, makeAppearance, type Theme } from "./appearance.ts";
import { createDiffHighlight, createDiffHighlightPool } from "./diff-highlighter.ts";
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
  readonly selectingServer: boolean;
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
  const drafts = yield* NewSessionDrafts;
  const effects = yield* makeWorkspaceOwner(registry);
  const desktop = host.kind === "desktop" ? host : undefined;
  const defaultMode = desktop ? "local" : "remote";
  const state = Atom.make<ConnectionState>({
    mode: defaultMode,
    selectingServer: !desktop,
    serverUrl: "",
    password: "",
    status: "disconnected",
    localUnavailable: false,
  });
  effects.mount(state);
  const get = () => registry.get(state);
  const update = (patch: Partial<ConnectionState>) =>
    registry.update(state, (value) => ({ ...value, ...patch }));
  let operation: Fiber.Fiber<void> | undefined;
  const workspace = effects.runSync(
    ScopedRef.make<ConnectionState["workspace"] | void>(() => undefined),
  );

  const leave = Effect.fn("Connection.leave")(function* () {
    get().workspace?.model.drafts.flushSelected();
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
          ? "The built-in OpenCode server is unavailable. Retry to start it again."
          : "The OpenCode server connection could not be set up. Check the address and try again.";
    update({ owner: undefined, status: "failed", error });
  };

  const connect = (
    mode: Mode,
    remote = { serverUrl: get().serverUrl, password: get().password },
  ) => {
    if (mode === "local" && !desktop) return;
    update({
      mode,
      selectingServer: mode === "remote",
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
                      serverUrl: server.serverUrl,
                      defaultLocation: server.location,
                      effects: owner,
                      saveFile: host.saveFile,
                    });
                    model = createWorkspaceModel(
                      runtime,
                      {
                        service: drafts,
                        serverKey: mode === "local" ? "built-in" : server.serverUrl,
                      },
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
    update({
      owner: undefined,
      status: "disconnected",
      password: "",
      error: undefined,
      selectingServer: true,
      mode: old.owner ?? old.savedTarget?.kind ?? defaultMode,
      serverUrl: old.owner === "local" ? "" : old.serverUrl,
    });
    replace(leave());
  };
  const forget = () => {
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
      selectingServer: true,
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
    if (get().owner === "local") {
      update({
        owner: undefined,
        status: "failed",
        error: "The built-in OpenCode server stopped. Restart it to continue.",
      });
      replace(leave());
    }
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribe?.();
    }),
  );
  // Desktop launches always use the app-owned server, independently of saved targets.
  if (desktop) {
    connect("local");
  } else {
    replace(
      effects
        .request<OpenCodeTarget | undefined>(() => host.target.load())
        .pipe(
          Effect.tap((loaded) =>
            Effect.sync(() => {
              if (loaded?.kind !== "remote") return;
              update({
                savedTarget: { kind: "remote", serverUrl: loaded.serverUrl },
                serverUrl: loaded.serverUrl,
              });
            }),
          ),
          Effect.asVoid,
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
  }
  return {
    state,
    builtInAvailable: desktop !== undefined,
    connect,
    changeServer,
    forget,
    setMode,
    setServerUrl: (serverUrl: string) => {
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
    Layer.mergeAll(
      Layer.effect(Connection, makeConnection(host, registry)).pipe(
        Layer.provideMerge(
          Layer.effect(NewSessionDrafts, makeNewSessionDrafts(registry)).pipe(
            Layer.provideMerge(Layer.effect(Storage, makeStorage(draftDatabase))),
          ),
        ),
      ),
      Layer.effect(Appearance, makeAppearance(registry)),
      SyntaxHighlight.layer,
    ),
  );
  const connection = runtime.runSync(Connection);
  const appearance = runtime.runSync(Appearance);
  const diffHighlightState = Atom.make<WorkerPoolManager | undefined>(undefined);
  const unmountDiffHighlight = registry.mount(diffHighlightState);
  const diffHighlight = createDiffHighlight({
    initialTheme: registry.get(appearance.state).theme,
    onChange: (manager) => registry.set(diffHighlightState, manager),
    createPool: createDiffHighlightPool() ?? undefined,
  });
  let closing: Promise<void> | undefined;
  return {
    registry,
    connection,
    highlightCode: (input: HighlightSnippet, signal: AbortSignal) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* SyntaxHighlight;
          return yield* service.highlight(input);
        }).pipe(
          Effect.catchTag("SyntaxHighlightError", (error) =>
            Effect.logWarning(
              "Syntax highlighting could not load; keeping plain code",
              error.message,
            ).pipe(Effect.as(undefined)),
          ),
        ),
        { signal },
      ),
    /* The host owns how a web link leaves the window; the caller reports failure. */
    openExternal: (url: string) => host.openExternal(url),
    appearance: {
      state: appearance.state,
      setTheme: (theme: Theme) => {
        if (!closing) runtime.runSync(appearance.setTheme(theme));
      },
    },
    diffHighlight: {
      state: diffHighlightState,
      setTheme: (theme: Theme) => diffHighlight.setTheme(theme),
    },
    dispose: () =>
      (closing ??= Effect.runPromise(runtime.disposeEffect.pipe(Effect.uninterruptible)).finally(
        () => {
          diffHighlight.dispose();
          unmountDiffHighlight();
          registry.dispose();
        },
      )),
  };
}
export type Renderer = ReturnType<typeof createRenderer>;
