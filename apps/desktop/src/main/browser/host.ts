import { NodeHttpClient } from "@effect/platform-node";
import { OpenCode } from "@opencode-ai/client/effect";
import { Browser } from "@opencode/plugin-browser/rpc";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Predicate,
  Queue,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { BrowserWindow } from "electron";

import {
  emptyBrowserState,
  type BrowserAttach,
  type BrowserEvent,
  type BrowserLayout,
} from "../../shared/browser-api.ts";
import { parseServerUrl } from "../../shared/server-url.ts";
import { createBrowserNetwork } from "./network.ts";
import { createNativeBrowser, type NativeBrowser } from "./native.ts";
import { browserFailure } from "./upstream/errors.ts";

class BrowserHostError extends Schema.TaggedError<BrowserHostError>()("BrowserHostError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

type Entry = {
  readonly input: BrowserAttach;
  readonly window: BrowserWindow;
  fiber?: Fiber.Fiber<void>;
  connection?: {
    native: NativeBrowser;
    command: (action: Browser.Action) => Effect.Effect<void, BrowserHostError | Cause.TimeoutError>;
  };
};

/** Signal cancellation, then await native settlement before releasing the command permit. */
const nativeRequest = (native: NativeBrowser, command: Browser.Command) =>
  Effect.callback<Browser.Result, BrowserHostError>((resume, signal) => {
    const pending = native.execute(command, signal).then(
      (result) => resume(Effect.succeed(result)),
      (cause) =>
        resume(
          Effect.fail(
            new BrowserHostError({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Browser operation failed. Inspect the page before repeating it.",
            }),
          ),
        ),
    );
    return Effect.promise(() => pending);
  });

const make = Effect.fn("BrowserHost.make")(function* () {
  const scope = yield* Effect.scope;
  const http = yield* HttpClient.HttpClient;
  const entries = new Map<string, Entry>();
  const owned = (win: BrowserWindow, id: string) => {
    const entry = entries.get(id);
    return entry?.window === win ? entry : undefined;
  };
  const lifetime = Effect.fn("BrowserHost.attachment")(function* (
    entry: Entry,
    emit: (event: BrowserEvent) => void,
    attached: Deferred.Deferred<void>,
  ) {
    const sessionScope = yield* Effect.scope;
    const { bindingID, sessionID, serverUrl, password } = entry.input;
    const client = yield* OpenCode.make({ baseUrl: serverUrl }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        password
          ? HttpClient.mapRequest(
              http,
              HttpClientRequest.setHeader(
                "authorization",
                `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
              ),
            )
          : http,
      ),
    );
    const session = yield* client.session.get({ sessionID });
    const options = {
      location: { directory: session.location.directory, workspace: session.location.workspaceID },
    };
    const attachment = { sessionID, connectionID: bindingID };
    const rpc = client.rpc(Browser.Definition);
    // oxlint-disable-next-line effecttsgo/crypto-random-uuid-in-effect -- Each attachment needs a fresh private partition, even if its binding ID is reused.
    const partition = `ocui-browser-${crypto.randomUUID()}`;
    const network = yield* createBrowserNetwork(rpc, attachment, options.location, partition);
    const outbound = yield* Queue.unbounded<Effect.Effect<void, BrowserHostError>>();
    const enqueue = <A, E>(operation: Effect.Effect<A, E>) =>
      Queue.offerUnsafe(
        outbound,
        operation.pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new BrowserHostError({
                message:
                  "Browser state or result could not be delivered. The action may already have run.",
                cause,
              }),
          ),
        ),
      );
    // State and focus precede results, including state published synchronously by native operations.
    const sendState = (state: Browser.State, error?: string) =>
      enqueue(
        rpc
          .state({ ...attachment, state }, options)
          .pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                emit({ bindingID, type: "state", status: "connected", state, error }),
              ),
            ),
          ),
      );
    const native = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createNativeBrowser(entry.window, partition, network, sendState, (tabID) => {
          enqueue(Effect.sync(() => emit({ bindingID, type: "focus", tabID })));
        }),
      ),
      (browser) => {
        entry.connection = undefined;
        return Effect.promise(() => browser.dispose());
      },
    );
    const gate = Semaphore.makeUnsafe(1);
    const perform = (command: Browser.Command) => {
      const request = nativeRequest(native, command);
      // Stop/close must release a navigation that is still holding the permit.
      return command.action.type === "stop" || command.action.type === "tabs.close"
        ? request
        : gate.withPermit(request);
    };
    const requests = yield* FiberMap.make<string, void, never>();
    const connected = yield* Deferred.make<void>();
    const receive = client.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "server.connected") {
            yield* Deferred.succeed(connected, undefined);
            return;
          }
          if (event.type !== "rpc.experimental.browser.control") return;
          const control = yield* Schema.decodeUnknownEffect(Browser.Control)(event.data);
          if (control.connectionID !== bindingID) return;
          if (control.type === "attached") {
            entry.connection = {
              native,
              command: (action) =>
                perform({ action, files: [] }).pipe(
                  Effect.timeout("60 seconds"),
                  Effect.forkIn(sessionScope),
                  Effect.flatMap(Fiber.join),
                  Effect.asVoid,
                ),
            };
            sendState(native.state());
            yield* Deferred.succeed(attached, undefined);
            return;
          }
          if (control.type === "cancel") {
            yield* FiberMap.remove(requests, control.requestID).pipe(Effect.forkScoped);
            return;
          }
          const reply = (outcome: typeof Browser.Outcome.Encoded) =>
            enqueue(rpc.result({ ...attachment, requestID: control.requestID, outcome }, options));
          yield* rpc.command({ ...attachment, requestID: control.requestID }, options).pipe(
            Effect.flatMap((command) =>
              perform(command).pipe(
                Effect.match({
                  onSuccess: (result): Browser.Outcome => ({ type: "success", result }),
                  onFailure: (error) => browserFailure(command.action, error),
                }),
              ),
            ),
            Effect.flatMap(Schema.encodeEffect(Browser.Outcome)),
            Effect.tap((outcome) => Effect.sync(() => reply(outcome))),
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (Schema.isSchemaError(error))
                  reply({
                    type: "failure",
                    code: "unsupported",
                    message:
                      "This desktop does not support the requested browser operation. Update the desktop or use another operation.",
                  });
                yield* Effect.logWarning(
                  "Browser command could not be retrieved or decoded",
                  error,
                );
              }),
            ),
            Effect.asVoid,
            FiberMap.run(requests, control.requestID),
          );
        }),
      ),
    );
    return yield* Effect.raceAllFirst([
      receive,
      Stream.fromQueue(outbound).pipe(Stream.runForEach((operation) => operation)),
      Deferred.await(connected).pipe(
        Effect.andThen(rpc.attach({ ...attachment, version: 4 }, options)),
        Effect.map((reason) => ({
          status: reason === "replaced" ? ("replaced" as const) : ("failed" as const),
          error:
            reason === "replaced"
              ? "Another desktop connected to this session's browser. Reconnect only when you want to take control."
              : "Browser connection ended. Reconnect and inspect the page before repeating an action.",
        })),
      ),
    ]);
  });

  const attach = Effect.fn("BrowserHost.attach")(function* (
    win: BrowserWindow,
    input: BrowserAttach,
    emit: (event: BrowserEvent) => void,
  ) {
    const serverUrl = yield* Effect.try({
      try: () => parseServerUrl(input.serverUrl).origin,
      catch: () => new BrowserHostError({ message: "Invalid browser server address." }),
    });
    if (
      win.isDestroyed() ||
      entries.has(input.bindingID) ||
      Array.from(entries.values()).some(
        (entry) =>
          entry.window === win &&
          entry.input.serverUrl === serverUrl &&
          entry.input.sessionID === input.sessionID,
      )
    )
      return yield* new BrowserHostError({
        message: "This browser attachment is already registered or unavailable.",
      });
    const entry: Entry = {
      input: { ...input, serverUrl },
      window: win,
    };
    entries.set(input.bindingID, entry);
    const windowClosed = Effect.callback<void>((resume) => {
      const stop = () => resume(Effect.void);
      const navigate = (
        event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>,
      ) => {
        if (event.isMainFrame && !event.isSameDocument) stop();
      };
      win.webContents.once("destroyed", stop);
      win.webContents.on("did-start-navigation", navigate);
      return Effect.sync(() => {
        win.webContents.off("destroyed", stop);
        win.webContents.off("did-start-navigation", navigate);
      });
    });
    const attached = yield* Deferred.make<void>();
    entry.fiber = yield* lifetime(entry, emit, attached).pipe(
      Effect.raceFirst(
        Deferred.await(attached).pipe(Effect.timeout("15 seconds"), Effect.andThen(Effect.never)),
      ),
      Effect.scoped,
      Effect.raceFirst(windowClosed),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          entries.delete(input.bindingID);
          let status: Extract<BrowserEvent, { type: "state" }>["status"] = "closed";
          let error: string | undefined;
          if (Exit.isSuccess(exit) && exit.value) ({ status, error } = exit.value);
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
            yield* Effect.logError("Browser attachment failed", exit.cause);
            const failure = Cause.squash(exit.cause);
            const unsupported =
              Predicate.hasProperty(failure, "type") &&
              ["rpc.unavailable", "rpc.method_not_found", "rpc.invalid_input"].includes(
                String(failure.type),
              );
            status = unsupported ? "unsupported" : "failed";
            error = unsupported
              ? "This server does not support the pinned browser protocol."
              : "Browser connection failed. Reconnect and inspect the page before repeating an action.";
          }
          emit({
            bindingID: input.bindingID,
            type: "state",
            status,
            state: emptyBrowserState(),
            error,
          });
        }),
      ),
      Effect.ignoreCause,
      Effect.asVoid,
      Effect.forkIn(scope),
    );
    return yield* Fiber.join(entry.fiber);
  });
  const detach = Effect.fn("BrowserHost.detach")(function* (win: BrowserWindow, id: string) {
    const entry = owned(win, id);
    if (entry?.fiber) yield* Fiber.interrupt(entry.fiber);
  });
  const command = Effect.fn("BrowserHost.command")(function* (
    win: BrowserWindow,
    id: string,
    action: Browser.Action,
  ) {
    const connection = owned(win, id)?.connection;
    if (!connection) return yield* new BrowserHostError({ message: "Browser is not connected." });
    return yield* connection.command(action);
  });
  const layout = Effect.fn("BrowserHost.layout")((win: BrowserWindow, input: BrowserLayout) =>
    Effect.sync(() => {
      const connection = owned(win, input.bindingID)?.connection;
      if (!connection || win.isDestroyed()) return;
      if (input.visible)
        entries.forEach((other) => {
          if (other.window === win && other.connection !== connection)
            other.connection?.native.hide();
        });
      connection.native.layout(input);
    }),
  );
  return { attach, detach, command, layout };
});

export class BrowserHost extends Context.Service<
  BrowserHost,
  Effect.Success<ReturnType<typeof make>>
>()("desktop/BrowserHost") {
  static readonly layer = Layer.effect(BrowserHost, make()).pipe(
    Layer.provide(NodeHttpClient.layerNodeHttp),
  );
}
