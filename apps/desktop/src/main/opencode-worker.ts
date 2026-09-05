import { Cause, Deferred, Effect, Exit, Ref, Schema } from "effect";

import { OPENCODE_VERSION } from "../shared/desktop-api.ts";
import { parseWorkerCommand } from "../shared/opencode-worker-contract.ts";
import type {
  OpenCodeWorkerCommand,
  OpenCodeWorkerMessage,
} from "../shared/opencode-worker-contract.ts";
import { configureOpenCodeLaunch } from "./opencode-launch-settings.ts";

class InvalidWorkerCommand extends Schema.TaggedError<InvalidWorkerCommand>()(
  "InvalidWorkerCommand",
  {},
) {}

const parent = process.parentPort;
const start = Deferred.makeUnsafe<Extract<OpenCodeWorkerCommand, { type: "start" }>>();
const stop = Deferred.makeUnsafe<void, InvalidWorkerCommand>();
const shutdown = Ref.makeUnsafe(Effect.void);
const signalShutdown = Ref.getAndSet(shutdown, Effect.void).pipe(Effect.flatten);

function send(message: OpenCodeWorkerMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
  parent.postMessage(message);
}

// Installed before any asynchronous import. Stop never queues behind library boot.
parent.on("message", (event: { data: unknown }) => {
  try {
    const command = parseWorkerCommand(event.data);
    if (command.type === "stop") Deferred.doneUnsafe(stop, Effect.void);
    else if (!Deferred.isDoneUnsafe(stop) && !Deferred.doneUnsafe(start, Effect.succeed(command))) {
      throw new Error("Worker was already started");
    }
  } catch {
    Deferred.doneUnsafe(stop, Effect.fail(new InvalidWorkerCommand()));
  }
});
process.on("SIGTERM", () => {
  Deferred.doneUnsafe(stop, Effect.void);
});

const launch = Effect.gen(function* () {
  const command = yield* Deferred.await(start);
  // These imports cannot be canceled; retain them until they settle before exiting.
  const settings = yield* Effect.promise(() => configureOpenCodeLaunch(command.userDataPath)).pipe(
    Effect.uninterruptible,
  );
  const { ServerProcess } = yield* Effect.promise(() => import("@opencode-ai/server/process")).pipe(
    Effect.uninterruptible,
  );
  yield* ServerProcess.start(
    {
      ...settings,
      hostname: "127.0.0.1",
      port: 0,
      password: command.password,
      app: { name: "oc-ui", version: OPENCODE_VERSION },
    },
    {
      onListen: (address, signal) =>
        Effect.gen(function* () {
          // Signal first, then close the retained upstream scope. start's result only waits.
          yield* Ref.set(shutdown, signal);
          if (address._tag !== "TcpAddress" || address.hostname !== "127.0.0.1") {
            return yield* Effect.die(new Error("Unexpected listen address"));
          }
          if (yield* Deferred.isDone(stop)) yield* signalShutdown;
          else {
            send({ type: "listening", url: `http://127.0.0.1:${address.port}` });
          }
          return yield* Effect.void;
        }).pipe(Effect.as(Effect.void)),
    },
  );
  return yield* Effect.never;
}).pipe(
  Effect.catchCauseIf(
    (cause) => !Cause.hasInterruptsOnly(cause),
    () => Effect.sync(fatal),
  ),
);

Effect.runFork(
  launch.pipe(
    Effect.raceFirst(
      Deferred.await(stop).pipe(
        Effect.catchTag("InvalidWorkerCommand", () => Effect.sync(fatal)),
        Effect.andThen(signalShutdown),
      ),
    ),
    Effect.ensuring(signalShutdown),
    Effect.scoped,
  ),
).addObserver((exit) => {
  if (Exit.isSuccess(exit)) process.exit(0);
  else fatal();
});

function fatal(): void {
  try {
    send({ type: "fatal", message: "Built-in OpenCode failed." });
  } catch {
    // Parent may already be closing. It still owns termination escalation.
  }
}
