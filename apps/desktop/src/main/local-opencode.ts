import { randomBytes } from "node:crypto";

import { utilityProcess } from "electron";
import type { ForkOptions, UtilityProcess } from "electron";
import { Context, Deferred, Effect, Fiber, Layer, Option, Schema, Scope } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

import { OPENCODE_VERSION } from "../shared/desktop-api.ts";
import type { LocalOpenCodeConnection } from "../shared/desktop-api.ts";
import { parseWorkerMessage } from "../shared/opencode-worker-contract.ts";
import type { OpenCodeWorkerCommand } from "../shared/opencode-worker-contract.ts";

export const LOCAL_OPENCODE_VERSION = OPENCODE_VERSION;
const START_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 2_000;
const STOP_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 2_000;
const HealthResponseSchema = Schema.Struct({ version: Schema.String, pid: Schema.Int });

const FailureReasonSchema = Schema.Literals([
  "invalid-endpoint",
  "start-failed",
  "stop-failed",
  "timed-out",
]);
type FailureReason = typeof FailureReasonSchema.Type;
const failureMessages = {
  "invalid-endpoint": "The built-in OpenCode server returned invalid connection details.",
  "start-failed": "The built-in OpenCode server failed to start.",
  "stop-failed": "The built-in OpenCode server could not be stopped.",
  "timed-out": "The built-in OpenCode server did not start before the startup timeout.",
} satisfies Record<FailureReason, string>;

export class LocalOpenCodeUnavailableError extends Schema.TaggedError<LocalOpenCodeUnavailableError>()(
  "LocalOpenCodeUnavailableError",
  { reason: FailureReasonSchema, message: Schema.String },
) {
  static fromReason(reason: FailureReason): LocalOpenCodeUnavailableError {
    return new LocalOpenCodeUnavailableError({ reason, message: failureMessages[reason] });
  }
}

export class LocalOpenCode extends Context.Service<
  LocalOpenCode,
  {
    readonly connect: Effect.Effect<LocalOpenCodeConnection, LocalOpenCodeUnavailableError>;
    readonly needsQuitConfirmation: Effect.Effect<boolean>;
    readonly shutdown: Effect.Effect<void, LocalOpenCodeUnavailableError>;
    readonly onUnavailable: (listener: () => void) => () => void;
  }
>()("desktop/main/LocalOpenCode") {
  static layer(options: {
    readonly userDataPath: string;
    readonly workerPath: string;
    /** Development-only V8 inspector port for the built-in server child. */
    readonly inspectorPort?: string;
  }) {
    return Layer.effect(
      LocalOpenCode,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        // Shutdown runs before this scope closes, so it can still observe and stop its child.
        const scope = yield* Scope.fork(yield* Effect.scope);
        const listeners = new Set<() => void>();
        let current: Run | undefined;
        let closed = false;
        const notifyUnavailable = (): void => {
          for (const listener of listeners) {
            try {
              listener();
            } catch {
              /* Observers cannot take ownership of process cleanup. */
            }
          }
        };

        const stop = Effect.fn("LocalOpenCode.stop")(function* (run: Run) {
          if (run.exited) return;
          if (run.stopping === undefined || run.stopping.pollUnsafe() !== undefined) {
            run.stopping = yield* Effect.forkIn(
              Effect.gen(function* (): Effect.fn.Return<void, LocalOpenCodeUnavailableError> {
                run.endpoint = undefined;
                yield* Deferred.fail(
                  run.failure,
                  LocalOpenCodeUnavailableError.fromReason("start-failed"),
                );
                // A broken message port still leaves a child to terminate and reap.
                yield* Effect.ignore(
                  Effect.try(() => {
                    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
                    run.child.postMessage({ type: "stop" } satisfies OpenCodeWorkerCommand);
                  }),
                );
                if (yield* waitForExit(run, STOP_TIMEOUT_MS)) return yield* Effect.void;
                yield* Effect.ignore(Effect.try(() => run.child.kill()));
                if (yield* waitForExit(run, KILL_TIMEOUT_MS)) return yield* Effect.void;
                const pid = run.child.pid;
                if (process.platform !== "win32" && pid !== undefined && pid > 0) {
                  // Even ESRCH is not a substitute for Electron's exit notification.
                  yield* Effect.ignore(Effect.try(() => process.kill(pid, "SIGKILL")));
                }
                if (yield* waitForExit(run, KILL_TIMEOUT_MS)) return yield* Effect.void;
                return yield* LocalOpenCodeUnavailableError.fromReason("stop-failed");
              }),
              scope,
            );
          }
          yield* Fiber.join(run.stopping);
        });

        const connect = Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (closed) return yield* LocalOpenCodeUnavailableError.fromReason("start-failed");
            if (current !== undefined) {
              if (current.unavailable !== undefined) {
                const failure = current.unavailable;
                if (current.stopping !== undefined) yield* restore(Fiber.join(current.stopping));
                return yield* failure;
              }
              return yield* restore(Deferred.await(current.ready));
            }
            const forkOptions: ForkOptions = {
              serviceName: "Ocui built-in OpenCode",
              stdio: "pipe",
            };
            if (options.inspectorPort !== undefined) {
              forkOptions.execArgv = [`--inspect=${options.inspectorPort}`];
            }
            const child = yield* Effect.try({
              try: () => utilityProcess.fork(options.workerPath, [], forkOptions),
              catch: () => LocalOpenCodeUnavailableError.fromReason("start-failed"),
            });
            const password = randomBytes(32).toString("base64url");
            const listening = Deferred.makeUnsafe<
              LocalOpenCodeConnection,
              LocalOpenCodeUnavailableError
            >();
            const run: Run = {
              child,
              ready: Deferred.makeUnsafe(),
              failure: Deferred.makeUnsafe(),
              exit: Deferred.makeUnsafe(),
              exited: false,
            };
            current = run;
            const fail = (reason: FailureReason): void => {
              if (current !== run || run.exited) return;
              Deferred.doneUnsafe(
                run.failure,
                Effect.fail(LocalOpenCodeUnavailableError.fromReason(reason)),
              );
            };
            const onSpawn = (): void => {
              if (current !== run || run.exited || closed || run.stopping !== undefined) return;
              try {
                const command: OpenCodeWorkerCommand = {
                  type: "start",
                  userDataPath: options.userDataPath,
                  password,
                };
                // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
                child.postMessage(command);
              } catch {
                fail("start-failed");
              }
            };
            let receivedListening = false;
            const onMessage = (input: Parameters<typeof parseWorkerMessage>[0]): void => {
              if (current !== run || run.exited || closed || run.stopping !== undefined) return;
              try {
                const message = parseWorkerMessage(input);
                if (message.type === "fatal") return fail("start-failed");
                if (receivedListening) return fail("invalid-endpoint");
                const endpoint = { serverUrl: validateEndpoint(message.url), password };
                receivedListening = true;
                Deferred.doneUnsafe(listening, Effect.succeed(endpoint));
              } catch {
                fail("invalid-endpoint");
              }
            };
            const onError = (): void => fail("start-failed");
            const onExit = (): void => {
              if (run.exited) return;
              run.exited = true;
              const wasRunning = run.endpoint !== undefined;
              run.endpoint = undefined;
              Deferred.doneUnsafe(run.exit, Effect.void);
              Deferred.doneUnsafe(
                run.failure,
                Effect.fail(LocalOpenCodeUnavailableError.fromReason("start-failed")),
              );
              child.off("spawn", onSpawn);
              child.off("message", onMessage);
              child.off("error", onError);
              child.off("exit", onExit);
              if (current === run) current = undefined;
              if (wasRunning && !closed) notifyUnavailable();
            };
            child.on("spawn", onSpawn);
            child.on("message", onMessage);
            child.on("error", onError);
            child.on("exit", onExit);
            // Drain library output without copying provider or plugin secrets into main logs.
            child.stdout?.resume();
            child.stderr?.resume();
            run.monitor = yield* Effect.forkIn(
              Effect.gen(function* () {
                const endpoint = yield* Effect.gen(function* () {
                  const announced = yield* Deferred.await(listening);
                  yield* waitUntilReady(client, run, announced);
                  return announced;
                }).pipe(
                  Effect.timeoutOrElse({
                    duration: START_TIMEOUT_MS,
                    orElse: () => LocalOpenCodeUnavailableError.fromReason("timed-out"),
                  }),
                  Effect.raceFirst(Deferred.await(run.failure)),
                );
                if (yield* Deferred.isDone(run.failure)) return yield* Deferred.await(run.failure);
                run.endpoint = endpoint;
                yield* Deferred.succeed(run.ready, endpoint);
                return yield* Deferred.await(run.failure);
              }).pipe(
                Effect.catch((failure) =>
                  Effect.gen(function* () {
                    const wasRunning = run.endpoint !== undefined;
                    run.unavailable = failure;
                    run.endpoint = undefined;
                    if (wasRunning && !closed) notifyUnavailable();
                    const result = yield* Effect.exit(stop(run));
                    yield* Deferred.complete(
                      run.ready,
                      Effect.andThen(result, Effect.fail(failure)),
                    );
                  }),
                ),
              ),
              scope,
              { uninterruptible: false },
            );
            return yield* restore(Deferred.await(run.ready));
          }),
        );

        const shutdown = Effect.gen(function* () {
          closed = true;
          const run = current;
          if (run === undefined) return;
          yield* stop(run);
          if (run.monitor !== undefined) yield* Fiber.join(run.monitor);
        });
        yield* Effect.addFinalizer(() => shutdown.pipe(Effect.orDie));
        return LocalOpenCode.of({
          connect,
          shutdown,
          needsQuitConfirmation: Effect.sync(() => current !== undefined),
          onUnavailable: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        });
      }),
    ).pipe(Layer.provide(FetchHttpClient.layer));
  }
}

type Run = {
  readonly child: UtilityProcess;
  readonly ready: Deferred.Deferred<LocalOpenCodeConnection, LocalOpenCodeUnavailableError>;
  readonly failure: Deferred.Deferred<never, LocalOpenCodeUnavailableError>;
  readonly exit: Deferred.Deferred<void>;
  exited: boolean;
  endpoint?: LocalOpenCodeConnection;
  unavailable?: LocalOpenCodeUnavailableError;
  monitor?: Fiber.Fiber<void>;
  stopping?: Fiber.Fiber<void, LocalOpenCodeUnavailableError>;
};

function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid owned endpoint");
  return url.origin;
}

const waitUntilReady = Effect.fn("LocalOpenCode.waitUntilReady")(function* (
  client: HttpClient.HttpClient,
  run: Run,
  endpoint: LocalOpenCodeConnection,
) {
  while (true) {
    const ready = yield* Effect.gen(function* () {
      const response = yield* client.get(new URL("/api/health", endpoint.serverUrl), {
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
        },
      });
      if (response.status === 503) return false;
      if (response.status !== 200)
        return yield* LocalOpenCodeUnavailableError.fromReason("start-failed");
      const body = yield* HttpClientResponse.schemaBodyJson(HealthResponseSchema)(response);
      if (
        body.version !== LOCAL_OPENCODE_VERSION ||
        body.pid !== run.child.pid ||
        run.child.pid === undefined
      ) {
        return yield* LocalOpenCodeUnavailableError.fromReason("start-failed");
      }
      return true;
    }).pipe(
      Effect.timeoutOption(HEALTH_TIMEOUT_MS),
      Effect.mapError(() => LocalOpenCodeUnavailableError.fromReason("start-failed")),
    );
    if (Option.getOrElse(ready, () => false)) return;
    yield* Effect.sleep(100);
  }
});

const waitForExit = (run: Run, milliseconds: number) =>
  Deferred.await(run.exit).pipe(Effect.timeoutOption(milliseconds), Effect.map(Option.isSome));
