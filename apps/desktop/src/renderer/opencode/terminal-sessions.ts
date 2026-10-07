import type { LocationRef, OpenCodeClient, Pty } from "@opencode/client";
import {
  isInvalidRequestError,
  isUnauthorizedError,
  isForbiddenError,
  isPtyNotFoundError,
} from "@opencode/client";
import { createPtyClient, locationKey } from "@opencode/client/solid";
import { useAtomValue } from "@effect/atom-solid";
import { Clock, Effect, Fiber, Predicate, Random, Schema, Semaphore } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { PtyTransport } from "restty";
import type { Accessor } from "solid-js";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import { mapConnectionFailure } from "./connection.ts";

type TerminalSession = {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly location: LocationRef;
  readonly status:
    | "idle"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "failed"
    | "exited"
    | "closing";
  readonly error?: string;
};

export type TerminalSessions = {
  readonly entries: Accessor<readonly TerminalSession[]>;
  readonly activeID: (location: LocationRef) => string | undefined;
  readonly select: (id: string) => void;
  readonly creating: Accessor<boolean>;
  readonly error: Accessor<string | undefined>;
  readonly create: (location: LocationRef) => void;
  readonly sync: (location: LocationRef) => void;
  readonly close: (id: string) => void;
  readonly reconnect: (id: string) => void;
  readonly transport: (id: string) => PtyTransport;
};

type Callbacks = Parameters<PtyTransport["connect"]>[0]["callbacks"];
type Size = { cols: number; rows: number };
type Record = {
  session: TerminalSession;
  readonly mutations: Semaphore.Semaphore;
  socket?: WebSocket;
  connection?: Fiber.Fiber<void>;
  resize?: Fiber.Fiber<void>;
  pendingSize?: Size;
  callbacks?: Callbacks;
  generation: number;
  history: string;
  cursor?: number;
};

const REPLAY_LIMIT = 2 * 1024 * 1024;
const HEALTHY_CONNECTION_MS = 5_000;
const cursorSchema = Schema.Struct({ cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });
const decodeCursor = Schema.decodeUnknownSync(Schema.fromJsonString(cursorSchema));
const serverLocation = (location: LocationRef) => {
  if (location.workspaceID)
    return { directory: location.directory, workspace: location.workspaceID };
  return { directory: location.directory };
};
const detach = (r: Record) => {
  r.generation += 1;
  r.connection?.interruptUnsafe();
  r.socket = undefined;
};

/** The workspace owns shells and I/O; a transport owns only its current view binding. */
export function createTerminalSessions(input: {
  effects: WorkspaceOwner;
  api: OpenCodeClient;
  serverUrl: string;
  openSocket?: (url: URL) => WebSocket;
}): TerminalSessions {
  const { effects, api } = input;
  const entriesAtom = Atom.make<readonly TerminalSession[]>([]);
  const activeAtom = Atom.make<ReadonlyMap<string, string>>(new Map());
  const creatingAtom = Atom.make(false);
  const errorAtom = Atom.make<string | undefined>(undefined);
  effects.mount(entriesAtom);
  effects.mount(activeAtom);
  effects.mount(creatingAtom);
  effects.mount(errorAtom);
  const entries = useAtomValue(() => entriesAtom);
  const active = useAtomValue(() => activeAtom);
  const creating = useAtomValue(() => creatingAtom);
  const error = useAtomValue(() => errorAtom);
  const records = new Map<string, Record>();
  const closedIDs = new Set<string>();
  // An uncertain create is only reconciled, never repeated with a new title.
  const uncertain = new Map<string, string>();
  const discovery = effects.latest();
  let disposed = false;

  const publish = () =>
    effects.registry.set(
      entriesAtom,
      [...records.values()].map((r) => r.session),
    );
  const setStatus = (r: Record, status: TerminalSession["status"], message?: string) => {
    if (disposed || !records.has(r.session.id)) return;
    r.session = { ...r.session, status, error: message };
    publish();
  };
  const exited = (r: Record, code = 0) => {
    setStatus(r, "exited");
    r.callbacks?.onExit?.(code);
  };
  const select = (id: string) => {
    const r = records.get(id);
    if (!r || disposed) return;
    effects.registry.update(activeAtom, (current) =>
      new Map(current).set(locationKey(r.session.location), id),
    );
  };
  const admit = (info: Pty, location: LocationRef) => {
    if (closedIDs.has(info.id) || records.has(info.id)) return;
    records.set(info.id, {
      session: {
        id: info.id,
        title: info.title.startsWith("oc-ui terminal ")
          ? `Terminal ${records.size + 1}`
          : info.title
              .replace(/\p{Cc}/gu, "")
              .trim()
              .slice(0, 120) || "Terminal",
        cwd: info.cwd,
        location,
        status: info.status === "exited" ? "exited" : "idle",
      },
      mutations: Semaphore.makeUnsafe(1),
      generation: 0,
      history: "",
    });
  };

  const resize = (r: Record, cols: number, rows: number): boolean => {
    if (
      disposed ||
      r.session.status === "closing" ||
      r.session.status === "exited" ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols <= 0 ||
      rows <= 0
    )
      return false;
    r.pendingSize = { cols, rows };
    if (!r.resize) {
      const drain = Effect.gen(function* () {
        while (r.pendingSize) {
          if (disposed || r.session.status === "closing") return;
          yield* r.mutations.withPermit(
            Effect.gen(function* () {
              if (!r.pendingSize || disposed || r.session.status === "closing") return;
              const size = r.pendingSize;
              r.pendingSize = undefined;
              yield* effects
                .request((signal) =>
                  api.pty.update(
                    {
                      ptyID: r.session.id,
                      location: serverLocation(r.session.location),
                      size,
                    },
                    { signal },
                  ),
                )
                .pipe(
                  Effect.match({
                    onFailure: () =>
                      setStatus(r, r.session.status, "The terminal size could not be updated."),
                    onSuccess: () => {
                      if (r.session.status === "connected" && r.session.error)
                        setStatus(r, "connected");
                    },
                  }),
                );
            }),
          );
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            r.resize = undefined;
          }),
        ),
      );
      const fiber = effects.runFork(drain);
      if (fiber.pollUnsafe() === undefined) r.resize = fiber;
    }
    return true;
  };

  const connectOnce = Effect.fn("TerminalSessions.connectOnce")(function* (
    r: Record,
    generation: number,
  ) {
    const clock = yield* Clock.Clock;
    const current = () =>
      !disposed && r.generation === generation && r.session.status !== "closing";
    // Forward cancellation at the helper's SDK ticket boundary. Still retain
    // settlement and close a late socket if its external API ignores abortion.
    const socket = yield* effects.request((signal) =>
      createPtyClient(
        {
          ...api,
          pty: {
            ...api.pty,
            connect: {
              ...api.pty.connect,
              token: (request) => api.pty.connect.token(request, { signal }),
            },
          },
        },
        { url: input.serverUrl, openSocket: input.openSocket },
      )
        .connect({
          ptyID: r.session.id,
          location: serverLocation(r.session.location),
          cursor: r.cursor,
        })
        .then((attachment) => {
          if (signal.aborted || !current()) attachment.close();
          return attachment;
        }),
    );
    if (!current()) {
      socket.close();
      return { code: 1000, healthy: false };
    }
    r.socket = socket;
    return yield* Effect.callback<{ code: number; healthy: boolean }>((resume) => {
      let replay = "";
      let replaying = true;
      let readyAt: number | undefined;
      const output = (data: string) => {
        r.history = (r.history + data).slice(-REPLAY_LIMIT);
        r.callbacks?.onData?.(data);
      };
      const opened = () => {
        if (!current()) return;
        setStatus(r, "connected");
        r.callbacks?.onConnect?.();
      };
      const message = (event: MessageEvent) => {
        if (!current()) return;
        if (Predicate.isString(event.data)) {
          if (replaying) replay = (replay + event.data).slice(-REPLAY_LIMIT);
          else {
            r.cursor = (r.cursor ?? 0) + event.data.length;
            output(event.data);
          }
          return;
        }
        if (!(event.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(event.data);
        if (bytes[0] !== 0) return;
        try {
          const metadata = decodeCursor(new TextDecoder().decode(bytes.subarray(1)));
          if (replaying) {
            output(replay);
            replay = "";
            replaying = false;
            readyAt = clock.currentTimeMillisUnsafe();
          }
          r.cursor = metadata.cursor;
        } catch {
          socket.close();
        }
      };
      const closed = (event: CloseEvent) => {
        cleanup();
        resume(
          Effect.succeed({
            code: event.code,
            healthy:
              readyAt !== undefined &&
              clock.currentTimeMillisUnsafe() - readyAt >= HEALTHY_CONNECTION_MS,
          }),
        );
      };
      const failed = () => {
        socket.close();
      };
      const cleanup = () => {
        socket.removeEventListener("open", opened);
        socket.removeEventListener("message", message);
        socket.removeEventListener("close", closed);
        socket.removeEventListener("error", failed);
        if (socket.readyState !== 3) socket.close();
        if (r.socket === socket) r.socket = undefined;
      };
      socket.addEventListener("open", opened);
      socket.addEventListener("message", message);
      socket.addEventListener("close", closed);
      socket.addEventListener("error", failed);
      if (socket.readyState === 1) opened();
      if (socket.readyState === 3) {
        cleanup();
        resume(Effect.succeed({ code: 1006, healthy: false }));
      }
      return Effect.sync(cleanup);
    });
  });

  const start = (r: Record) => {
    const previous = r.connection;
    detach(r);
    const generation = r.generation;
    const current = () => !disposed && generation === r.generation;
    setStatus(r, "connecting");
    let connection: Fiber.Fiber<void> | undefined;
    connection = effects.runFork(
      Effect.gen(function* () {
        if (previous) yield* Fiber.await(previous);
        let attempt = 0;
        while (attempt <= 3) {
          if (!current()) return;
          if (attempt) {
            setStatus(r, "reconnecting");
            yield* Effect.sleep(250 * 2 ** (attempt - 1));
          }
          const result = yield* connectOnce(r, generation).pipe(Effect.result);
          if (!current()) return;
          r.callbacks?.onDisconnect?.();
          if (result._tag === "Success") {
            // Replay readiness alone does not make an open/close flap healthy.
            if (result.success.healthy) attempt = 0;
            if (result.success.code === 4404) {
              exited(r);
              return;
            }
            if (result.success.code === 1000) {
              const info = yield* effects
                .request((signal) =>
                  api.pty.get(
                    {
                      ptyID: r.session.id,
                      location: serverLocation(r.session.location),
                    },
                    { signal },
                  ),
                )
                .pipe(Effect.result);
              if (!current()) return;
              if (info._tag === "Success" && info.success.data.status === "exited") {
                exited(r, info.success.data.exitCode);
                return;
              }
            }
          }
          attempt += 1;
        }
        setStatus(r, "failed", "The terminal could not reconnect. Try reconnecting again.");
        r.callbacks?.onError?.(r.session.error!);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (r.connection === connection) r.connection = undefined;
          }),
        ),
      ),
    );
    if (connection.pollUnsafe() === undefined) r.connection = connection;
  };

  effects.runSync(
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposed = true;
        for (const r of records.values()) {
          r.callbacks = undefined;
          detach(r);
        }
      }),
    ),
  );

  const create = (location: LocationRef) => {
    if (disposed || effects.registry.get(creatingAtom)) return;
    const snapshot = { directory: location.directory, workspaceID: location.workspaceID };
    const key = locationKey(snapshot);
    const previous = uncertain.get(key);
    const title =
      previous ??
      `oc-ui terminal ${Array.from({ length: 4 }, () =>
        effects.runSync(Random.nextInt).toString(16),
      ).join("-")}`;
    effects.registry.set(creatingAtom, true);
    effects.registry.set(errorAtom, undefined);
    effects.runFork(
      Effect.gen(function* () {
        let info: Awaited<ReturnType<OpenCodeClient["pty"]["create"]>>["data"] | undefined;
        if (!previous) {
          uncertain.set(key, title);
          const result = yield* effects
            .request((signal) =>
              api.pty.create(
                {
                  location: serverLocation(snapshot),
                  cwd: snapshot.directory,
                  title,
                },
                { signal },
              ),
            )
            .pipe(Effect.result);
          if (result._tag === "Success") info = result.success.data;
          else if (
            isInvalidRequestError(result.failure.cause) ||
            isUnauthorizedError(result.failure.cause) ||
            isForbiddenError(result.failure.cause) ||
            mapConnectionFailure(result.failure.cause, "setup").reason === "unauthorized"
          ) {
            uncertain.delete(key);
            effects.registry.set(
              errorAtom,
              "The server rejected terminal creation. Check the connection and try again.",
            );
            return;
          }
        }
        if (!info) {
          const list = yield* effects.request((signal) =>
            api.pty.list({ location: serverLocation(snapshot) }, { signal }),
          );
          info = list.data.find((entry) => entry.title === title);
        }
        if (!info) {
          effects.registry.set(
            errorAtom,
            "Terminal creation could not be confirmed. Try again to check its status.",
          );
          return;
        }
        uncertain.delete(key);
        if (disposed) return;
        admit(info, snapshot);
        publish();
        select(info.id);
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (!disposed)
              effects.registry.set(
                errorAtom,
                "Terminal creation could not be confirmed. Try again to check its status.",
              );
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (!disposed) effects.registry.set(creatingAtom, false);
          }),
        ),
      ),
    );
  };

  const sync = (location: LocationRef) => {
    if (disposed) return;
    const snapshot = { directory: location.directory, workspaceID: location.workspaceID };
    const key = locationKey(snapshot);
    discovery.run(
      Effect.gen(function* () {
        const result = yield* effects.request((signal) =>
          api.pty.list(
            {
              location: serverLocation(snapshot),
            },
            { signal },
          ),
        );
        if (disposed) return;
        for (const info of result.data) {
          if (uncertain.get(key) === info.title) uncertain.delete(key);
          const existing = records.get(info.id);
          if (existing) {
            if (existing.session.status === "closing") continue;
            if (info.status === "exited") {
              detach(existing);
              exited(existing, info.exitCode);
            }
            continue;
          }
          admit(info, snapshot);
        }
        publish();
        const selected = effects.registry.get(activeAtom).get(key);
        if (!selected || !records.has(selected)) {
          const first = [...records.values()].find((r) => locationKey(r.session.location) === key);
          if (first) select(first.session.id);
        }
        effects.registry.set(errorAtom, undefined);
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (!disposed)
              effects.registry.set(errorAtom, "The terminal list could not be loaded.");
          }),
        ),
      ),
    );
  };

  const close = (id: string) => {
    const r = records.get(id);
    if (!r || disposed || r.session.status === "closing") return;
    setStatus(r, "closing");
    const previous = r.connection;
    detach(r);
    r.callbacks?.onDisconnect?.();
    effects.runFork(
      Effect.gen(function* () {
        if (previous) yield* Fiber.await(previous);
        yield* r.mutations.withPermit(
          effects
            .request((signal) =>
              api.pty.remove(
                {
                  ptyID: id,
                  location: serverLocation(r.session.location),
                },
                { signal },
              ),
            )
            .pipe(
              Effect.catchIf(
                (failure) => isPtyNotFoundError(failure.cause),
                () => Effect.void,
              ),
            ),
        );
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (disposed) return;
            closedIDs.add(id);
            records.delete(id);
            publish();
            const key = locationKey(r.session.location);
            if (effects.registry.get(activeAtom).get(key) === id) {
              const next = [...records.values()].find(
                (candidate) => locationKey(candidate.session.location) === key,
              );
              effects.registry.update(activeAtom, (current) => {
                const updated = new Map(current);
                updated.delete(key);
                if (next) updated.set(key, next.session.id);
                return updated;
              });
            }
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            setStatus(r, "failed", "The terminal could not be closed. Try closing it again."),
          ),
        ),
      ),
    );
  };

  return {
    entries,
    creating,
    error,
    create,
    sync,
    close,
    select,
    activeID: (location) => active().get(locationKey(location)),
    reconnect: (id) => {
      const r = records.get(id);
      if (r && !disposed && r.session.status !== "closing" && r.session.status !== "exited")
        start(r);
    },
    transport: (id) => {
      const r = records.get(id);
      let binding: Callbacks | undefined;
      const disconnect = () => {
        if (!r || !binding || r.callbacks !== binding) return;
        detach(r);
        if (["connecting", "connected", "reconnecting"].includes(r.session.status))
          setStatus(r, "idle");
      };
      return {
        connect: (options) => {
          if (!r || disposed || r.session.status === "closing" || r.session.status === "exited")
            return;
          binding = options.callbacks;
          r.callbacks = binding;
          if (r.history) binding.onData?.(r.history);
          if (options.cols !== undefined && options.rows !== undefined)
            resize(r, options.cols, options.rows);
          start(r);
        },
        disconnect,
        destroy: () => {
          disconnect();
          if (r && r.callbacks === binding) r.callbacks = undefined;
          binding = undefined;
        },
        isConnected: () =>
          !!binding && !disposed && r?.callbacks === binding && r?.socket?.readyState === 1,
        sendInput: (data) => {
          if (!binding || disposed || !r || r.callbacks !== binding || r.socket?.readyState !== 1)
            return false;
          try {
            r.socket.send(data);
            return true;
          } catch {
            return false;
          }
        },
        resize: (cols, rows) =>
          !!binding && !!r && r.callbacks === binding && resize(r, cols, rows),
      };
    },
  };
}
