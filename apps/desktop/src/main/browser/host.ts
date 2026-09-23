import { NodeHttpClient } from "@effect/platform-node";
import { OpenCode } from "@opencode/client/effect";
import { Browser } from "@opencode/plugin-browser/rpc";
import {
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Option,
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
  type BrowserAnnotationStart,
  type BrowserAttach,
  type BrowserEvent,
  type BrowserLayout,
} from "../../shared/browser-api.ts";
import { parseServerUrl } from "../../shared/server-url.ts";
import { clearBrowserPartition, createBrowserNetwork } from "./network.ts";
import {
  createNativeBrowser,
  type BrowserCheckpoint,
  type NativeBrowser,
  type RestoreOutcome,
} from "./native.ts";
import { browserFailure } from "./upstream/errors.ts";

class BrowserHostError extends Schema.TaggedError<BrowserHostError>()("BrowserHostError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

type ProfileLocation = { readonly directory: string; readonly workspaceID?: string };

/**
 * A window-scoped browser profile. The partition and the recovery record
 * outlive one attachment so a reconnect can keep cookies and reopen tabs.
 */
type Profile = {
  readonly partitionID: string;
  readonly location: ProfileLocation;
  /** Live tab inventory, refreshed from native publications. */
  live: BrowserCheckpoint;
  /** Destinations not reopened yet; they follow the live inventory. */
  pending: readonly string[];
  /** Focus index into the live inventory plus pending destinations. */
  focus: number | null;
};

const emptyCheckpoint = (): BrowserCheckpoint => ({ urls: [], focusedIndex: null });
const emptyProfile = (partitionID: string, location: ProfileLocation): Profile => ({
  partitionID,
  location,
  live: emptyCheckpoint(),
  pending: [],
  focus: null,
});
/** Refresh the live inventory without dropping destinations still awaiting a reconnect. */
const updateLive = (profile: Profile, live: BrowserCheckpoint) => {
  profile.live = live;
  if (live.focusedIndex !== null) profile.focus = live.focusedIndex;
  else if (profile.focus !== null && profile.focus < live.urls.length) profile.focus = null;
};
const recovery = (profile: Profile): BrowserCheckpoint => {
  const urls = [...profile.live.urls, ...profile.pending];
  return {
    urls,
    focusedIndex: profile.focus !== null && profile.focus < urls.length ? profile.focus : null,
  };
};
const sameLocation = (left: ProfileLocation, right: ProfileLocation) =>
  left.directory === right.directory && left.workspaceID === right.workspaceID;
const profileKey = (serverUrl: string, sessionID: string) => JSON.stringify([serverUrl, sessionID]);

const restoreNotice =
  "Browser reconnected and reopened its tabs. Unsaved page state was lost. Inspect the page before repeating an action.";
const partialRestoreNotice =
  "Browser reconnected and reopened some tabs; the rest stay saved for the next reconnect. Unsaved page state was lost. Inspect the page before repeating an action.";

type Entry = {
  readonly input: BrowserAttach;
  readonly window: BrowserWindow;
  fiber?: Fiber.Fiber<void>;
  connection?: {
    native: NativeBrowser;
    command: (action: Browser.Action) => Effect.Effect<void, BrowserHostError | Cause.TimeoutError>;
    annotate: (
      input: BrowserAnnotationStart,
    ) => Effect.Effect<void, BrowserHostError | Cause.TimeoutError>;
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

/** Signal cancellation, then await native restoration before publishing state. */
const nativeRestore = (
  native: NativeBrowser,
  checkpoint: BrowserCheckpoint,
  capture: (outcome: RestoreOutcome) => void,
) =>
  Effect.callback<RestoreOutcome, BrowserHostError>((resume, signal) => {
    const pending = native.restore(checkpoint, signal).then(
      (value) => {
        // A timed-out effect is interrupted before resuming; keep the partial result.
        capture(value);
        return resume(Effect.succeed(value));
      },
      (cause) =>
        resume(
          Effect.fail(
            new BrowserHostError({
              message:
                cause instanceof Error ? cause.message : "Browser tabs could not be restored.",
              cause,
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
  const profiles = new WeakMap<BrowserWindow, Map<string, Profile>>();
  const context = yield* Effect.context();
  const retirements = new Set<Fiber.Fiber<void>>();
  /** Owned retirement: stop the captured writers, then erase their storage. */
  const retireProfiles = Effect.fn("BrowserHost.retireProfiles")(function* (item: {
    profiles: readonly Profile[];
    entries: readonly Entry[];
  }) {
    for (const entry of item.entries) {
      if (entry.fiber) yield* Fiber.interrupt(entry.fiber);
    }
    for (const profile of item.profiles) {
      // Keep clearing owned until it settles, including during shutdown.
      yield* Effect.uninterruptible(
        Effect.promise(() => clearBrowserPartition(profile.partitionID)),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Browser profile storage could not be cleared", cause),
        ),
      );
    }
  });
  /** Invalidate a window's profiles now; the owned fiber erases their storage. */
  const retireWindow = (win: BrowserWindow) => {
    const map = profiles.get(win);
    if (!map) return;
    profiles.delete(win);
    const item = {
      profiles: Array.from(map.values()),
      // Capture only the attachments that existed when retirement was requested;
      // a reload can attach a fresh browser before this fiber runs.
      entries: Array.from(entries.values()).filter((entry) => entry.window === win),
    };
    let fiber: Fiber.Fiber<void> | undefined;
    fiber = Effect.runForkWith(context)(
      retireProfiles(item).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (fiber) retirements.delete(fiber);
          }),
        ),
      ),
    );
    retirements.add(fiber);
  };
  const listenersInstalled = new WeakSet<BrowserWindow>();
  const listenerCleanups = new Map<BrowserWindow, () => void>();
  const profileMap = (win: BrowserWindow) => {
    let map = profiles.get(win);
    if (!map) {
      map = new Map<string, Profile>();
      profiles.set(win, map);
    }
    if (listenersInstalled.has(win)) return map;
    listenersInstalled.add(win);
    // Reload and close are window-level lifetimes: install these once per window
    // so an idle retained profile is still discarded on reload, and remove them
    // only when the host owner ends.
    const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
      if (event.isMainFrame && !event.isSameDocument) retireWindow(win);
    };
    const closed = () => retireWindow(win);
    const destroyed = () => retireWindow(win);
    win.once("closed", closed);
    win.webContents.on("did-start-navigation", navigate);
    win.webContents.once("destroyed", destroyed);
    listenerCleanups.set(win, () => {
      win.off("closed", closed);
      if (!win.isDestroyed()) {
        win.webContents.off("did-start-navigation", navigate);
        win.webContents.off("destroyed", destroyed);
      }
      listenerCleanups.delete(win);
    });
    return map;
  };
  /** Reuse the partition and checkpoint only while the session stays in one location. */
  const profileFor = (
    win: BrowserWindow,
    serverUrl: string,
    sessionID: string,
    location: ProfileLocation,
  ) => {
    const map = profileMap(win);
    const key = profileKey(serverUrl, sessionID);
    const existing = map.get(key);
    if (existing && sameLocation(existing.location, location)) return { profile: existing };
    let retired: Profile | undefined;
    if (existing) {
      map.delete(key);
      retired = existing;
    }
    const profile = emptyProfile(
      // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- A profile keeps one private partition across attachments.
      `ocui-browser-${crypto.randomUUID()}`,
      location,
    );
    map.set(key, profile);
    return { profile, retired };
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
    const location: ProfileLocation = {
      directory: session.location.directory,
      workspaceID: session.location.workspaceID,
    };
    const options = {
      location: { directory: location.directory, workspace: location.workspaceID },
    };
    const attachment = { sessionID, connectionID: bindingID };
    const rpc = client.rpc(Browser.Definition);
    const { profile, retired } = profileFor(entry.window, serverUrl, sessionID, location);
    if (retired) {
      yield* Effect.uninterruptible(
        Effect.promise(() => clearBrowserPartition(retired.partitionID)),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Browser profile storage could not be cleared", cause),
        ),
      );
    }
    const network = yield* createBrowserNetwork(
      rpc,
      attachment,
      options.location,
      profile.partitionID,
    );
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
    // Native publications refresh the live inventory before delivery, except
    // while restoration rebuilds it and suppresses transient states. Pending
    // destinations survive every refresh.
    let nativeRef: NativeBrowser | undefined;
    let restoring = false;
    const publish = (state: Browser.State, error?: string) => {
      if (restoring) return;
      if (nativeRef) updateLive(profile, nativeRef.checkpoint());
      sendState(state, error);
    };
    const native = yield* Effect.acquireRelease(
      Effect.sync(() => {
        nativeRef = createNativeBrowser(
          entry.window,
          profile.partitionID,
          network,
          publish,
          (tabID) => {
            enqueue(Effect.sync(() => emit({ bindingID, type: "focus", tabID })));
          },
        );
        return nativeRef;
      }),
      (browser) => {
        const established = entry.connection !== undefined;
        entry.connection = undefined;
        // Failed setup keeps the previous recovery record; an established
        // attachment keeps its last local inventory even when delivery failed.
        if (established) updateLive(profile, browser.checkpoint());
        nativeRef = undefined;
        return Effect.promise(() => browser.dispose());
      },
    );
    const gate = Semaphore.makeUnsafe(1);
    // One pick and one command may never overlap on the same tab; other tabs proceed independently.
    const activity = new Map<
      Browser.TabID,
      { pick?: { stop: () => Promise<void> }; executing: number }
    >();
    const tabActivity = (id: Browser.TabID) => {
      let value = activity.get(id);
      if (!value) {
        value = { executing: 0 };
        activity.set(id, value);
      }
      return value;
    };
    const perform = (command: Browser.Command) => {
      const request = nativeRequest(native, command);
      const action = command.action;
      const admission = Effect.sync(() => {
        if (!("tabID" in action)) return undefined;
        const state = tabActivity(action.tabID);
        state.executing += 1;
        const pick = state.pick;
        state.pick = undefined;
        return pick;
      }).pipe(Effect.flatMap((pick) => (pick ? Effect.promise(() => pick.stop()) : Effect.void)));
      // Stop/close must release a navigation that is still holding the permit.
      const operation =
        action.type === "stop" || action.type === "tabs.close" ? request : gate.withPermit(request);
      const release = Effect.sync(() => {
        if ("tabID" in action) tabActivity(action.tabID).executing -= 1;
      });
      return admission.pipe(Effect.andThen(operation), Effect.ensuring(release));
    };
    const requests = yield* FiberMap.make<string, void, never>();
    const connected = yield* Deferred.make<void>();
    const restored = yield* Deferred.make<void>();
    // Restoration rebuilds the saved inventory before the connection is usable;
    // the restored state is published and acknowledged first, so no command
    // result can overtake it.
    const restore = Effect.gen(function* () {
      const checkpoint = recovery(profile);
      let notice: string | undefined;
      if (checkpoint.urls.length > 0) {
        restoring = true;
        let partial: RestoreOutcome | undefined;
        const outcome = yield* nativeRestore(native, checkpoint, (value) => {
          partial = value;
        }).pipe(
          Effect.timeoutOption("30 seconds"),
          Effect.catchCause((cause) =>
            Effect.logWarning("Browser tab restoration failed", cause).pipe(
              Effect.as(Option.none()),
            ),
          ),
        );
        restoring = false;
        const result = Option.isSome(outcome) ? outcome.value : partial;
        if (result) {
          // Unattempted destinations stay pending; failed ones keep their
          // destination and retry on the next reconnect.
          profile.pending = result.pending;
          profile.live = native.checkpoint();
          profile.focus = checkpoint.focusedIndex;
          notice = result.pending.length > 0 ? partialRestoreNotice : restoreNotice;
        } else {
          yield* Effect.logWarning("Browser tab restoration could not start");
          notice = partialRestoreNotice;
        }
        if (Option.isNone(outcome) && partial)
          yield* Effect.logWarning("Browser tab restoration did not finish in time");
      }
      entry.connection = {
        native,
        annotate: (input) =>
          Effect.gen(function* () {
            const state = tabActivity(input.tabID);
            if (state.pick || state.executing > 0)
              return yield* new BrowserHostError({
                message:
                  "The browser is busy with another action. Wait for it to finish, then annotate again.",
              });
            const handle = { stop: () => native.cancelAnnotation(input.tabID) };
            state.pick = handle;
            // The timeout cleanup awaits native settlement, so a terminal page
            // failure observed there is the real cause and wins over the timeout text.
            let failure: Error | undefined;
            const result = yield* Effect.callback<
              Awaited<ReturnType<NativeBrowser["annotate"]>>,
              BrowserHostError
            >((resume, signal) => {
              const pending = native
                .annotate({ tabID: input.tabID, number: input.number, mode: input.mode }, signal)
                .then(
                  (value) => resume(Effect.succeed(value)),
                  (cause) => {
                    if (cause instanceof Error) failure = cause;
                    resume(
                      Effect.fail(
                        new BrowserHostError({
                          message:
                            cause instanceof Error ? cause.message : "Annotation capture failed.",
                          cause,
                        }),
                      ),
                    );
                  },
                );
              return Effect.promise(() => pending);
            }).pipe(
              Effect.timeout("15 minutes"),
              Effect.mapError((error) =>
                Cause.isTimeoutError(error)
                  ? new BrowserHostError(
                      failure
                        ? { message: failure.message, cause: failure }
                        : { message: "Annotation timed out. Start the annotation again." },
                    )
                  : error,
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  if (state.pick === handle) state.pick = undefined;
                }),
              ),
            );
            if (!result) return yield* Effect.void;
            emit({
              bindingID,
              type: "annotation",
              capture: {
                requestID: input.requestID,
                number: input.number,
                mode: result.mode,
                tab: result.tab,
                capturedAt: DateTime.formatIso(DateTime.nowUnsafe()),
                selection: result.selection,
                body: result.body,
                image: result.image,
              },
            });
            return yield* Effect.void;
          }),
        command: (action) =>
          perform({ action, files: [] }).pipe(
            Effect.timeout("60 seconds"),
            Effect.forkIn(sessionScope),
            Effect.flatMap(Fiber.join),
            Effect.asVoid,
          ),
      };
      sendState(native.state(), notice);
    }).pipe(Effect.ensuring(Deferred.succeed(restored, undefined)));
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
            yield* Deferred.succeed(attached, undefined);
            yield* Effect.forkIn(restore, sessionScope);
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
              Deferred.await(restored).pipe(
                Effect.andThen(perform(command)),
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
            const failure = Cause.squash(exit.cause);
            const type = Predicate.hasProperty(failure, "type") ? String(failure.type) : undefined;
            const unsupported =
              type !== undefined && ["rpc.method_not_found", "rpc.invalid_input"].includes(type);
            // A closed RPC service is a recoverable disconnect, not proof that the
            // server lacks the pinned browser protocol.
            if (type === "rpc.unavailable" && Deferred.isDoneUnsafe(attached))
              yield* Effect.logWarning("Browser attachment disconnected", exit.cause);
            else yield* Effect.logError("Browser attachment failed", exit.cause);
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
  const annotate = Effect.fn("BrowserHost.annotate")(function* (
    win: BrowserWindow,
    input: BrowserAnnotationStart,
  ) {
    const connection = owned(win, input.bindingID)?.connection;
    if (!connection) return yield* new BrowserHostError({ message: "Browser is not connected." });
    return yield* connection.annotate(input);
  });
  const annotationCancel = Effect.fn("BrowserHost.annotationCancel")(function* (
    win: BrowserWindow,
    input: { readonly bindingID: string; readonly tabID: Browser.TabID },
  ) {
    const connection = owned(win, input.bindingID)?.connection;
    if (!connection || win.isDestroyed()) return;
    yield* Effect.promise(() => connection.native.cancelAnnotation(input.tabID));
  });
  /** Stop matching attachments and erase their retained profile and storage. */
  const forget = Effect.fn("BrowserHost.forget")(function* (
    win: BrowserWindow,
    input: { readonly serverUrl: string; readonly sessionID: string },
  ) {
    const serverUrl = yield* Effect.try({
      try: () => parseServerUrl(input.serverUrl).origin,
      catch: () => new BrowserHostError({ message: "Invalid browser server address." }),
    });
    const matching = Array.from(entries.values()).filter(
      (entry) =>
        entry.window === win &&
        entry.input.serverUrl === serverUrl &&
        entry.input.sessionID === input.sessionID,
    );
    for (const entry of matching) {
      if (entry.fiber) yield* Fiber.interrupt(entry.fiber);
    }
    const map = profiles.get(win);
    const profile = map?.get(profileKey(serverUrl, input.sessionID));
    if (!profile) return;
    map?.delete(profileKey(serverUrl, input.sessionID));
    yield* Effect.uninterruptible(
      Effect.promise(() => clearBrowserPartition(profile.partitionID)),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Browser profile storage could not be cleared", cause),
      ),
    );
  });
  // Drain accepted retirements before the owner finishes. Listener removal runs
  // first (registered later), so no new retirement starts during the drain.
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...retirements], (fiber) => Fiber.await(fiber), { discard: true }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const cleanup of listenerCleanups.values()) cleanup();
      listenerCleanups.clear();
    }),
  );
  return { attach, detach, command, layout, annotate, annotationCancel, forget };
});

export class BrowserHost extends Context.Service<
  BrowserHost,
  Effect.Success<ReturnType<typeof make>>
>()("desktop/BrowserHost") {
  static readonly layer = Layer.effect(BrowserHost, make()).pipe(
    Layer.provide(NodeHttpClient.layerNodeHttp),
  );
}
