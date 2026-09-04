import { Effect, Exit, Scope } from "effect";

import { OPENCODE_VERSION } from "../shared/desktop-api.ts";
import { parseWorkerCommand } from "../shared/opencode-worker-contract.ts";
import type { OpenCodeWorkerMessage } from "../shared/opencode-worker-contract.ts";
import { configureOpenCodeLaunch } from "./opencode-launch-settings.ts";

const parent = process.parentPort;
const abort = new AbortController();
let starting: Promise<void> | undefined;
let stopping: Promise<void> | undefined;
let scope: Scope.Closeable | undefined;
let signalShutdown: Effect.Effect<void> | undefined;
let stopRequested = false;

function send(message: OpenCodeWorkerMessage): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron IPC, not a browser Window.
  parent.postMessage(message);
}

function stop(): Promise<void> {
  stopRequested = true;
  abort.abort();
  if (stopping !== undefined) return stopping;
  stopping = (async () => {
    if (signalShutdown !== undefined) await Effect.runPromise(signalShutdown);
    await starting?.catch(() => undefined);
    if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.void));
    process.exit(0);
  })();
  return stopping;
}

// Installed before any asynchronous import. Stop never queues behind library boot.
parent.on("message", (event: { data: unknown }) => {
  try {
    const command = parseWorkerCommand(event.data);
    if (command.type === "stop") {
      void stop().catch(fatal);
      return;
    }
    if (stopRequested) return;
    if (starting !== undefined) throw new Error("Worker was already started");
    starting = (async () => {
      const settings = await configureOpenCodeLaunch(command.userDataPath);
      if (stopRequested) return;
      const { ServerProcess } = await import("@opencode-ai/server/process");
      if (stopRequested) return;
      scope = await Effect.runPromise(Scope.make());
      if (stopRequested) return;
      await Effect.runPromise(
        ServerProcess.start(
          {
            ...settings,
            hostname: "127.0.0.1",
            port: 0,
            password: command.password,
            app: { name: "oc-ui", version: OPENCODE_VERSION },
          },
          {
            onListen: (address, shutdown) =>
              Effect.sync(() => {
                signalShutdown = shutdown;
                if (address._tag !== "TcpAddress" || address.hostname !== "127.0.0.1") {
                  throw new Error("Unexpected listen address");
                }
                if (!stopRequested)
                  send({ type: "listening", url: `http://127.0.0.1:${address.port}` });
                return Effect.void;
              }),
          },
        ).pipe(Effect.provideService(Scope.Scope, scope)),
        { signal: abort.signal },
      );
    })();
    void starting.catch(() => {
      if (!stopRequested) fatal();
    });
  } catch {
    fatal();
  }
});

function fatal(): void {
  try {
    send({ type: "fatal", message: "Built-in OpenCode failed." });
  } catch {
    // Parent may already be closing. It still owns termination escalation.
  }
  void stop().catch(() => {
    // Keep ownership visible to main; a failed finalizer is not a clean exit.
  });
}

process.on("SIGTERM", () => {
  void stop().catch(fatal);
});
