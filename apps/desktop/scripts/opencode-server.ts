import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Cause, Deferred, Effect, Exit } from "effect";
import { ServerProcess } from "@opencode/server/process";
import { Global } from "@opencode/util/global";

import { OPENCODE_VERSION } from "../src/shared/desktop-api.ts";

// Standalone OpenCode server bundle entry for browser-mode development and
// acceptance tests. It is bundled by scripts/opencode-server-build.mjs with the
// same esbuild recipe as the Electron worker and must not be run directly.
// Environment contract:
//   OPENCODE_SERVER_PASSWORD  Basic auth password; a random password is generated and printed when unset.
//   OPENCODE_DB               SQLite database path; relative paths resolve under the OpenCode data directory.
//                             Defaults to opencode.db there. ":memory:" is allowed for ephemeral runs.
//   OPENCODE_CONFIG_DIR       OpenCode config directory.
//   OPENCODE_CONFIG           OpenCode config file.
//   OPENCODE_CONFIG_CONTENT   OpenCode config JSON.
//   OPENCODE_PTY_BIN          Persistent PTY binary; resolved from the pinned @opencode-ai/pty package when unset.
const usage = `Usage: opencode-server [--hostname <host>] [--port <port>] [--cors <origin>...]

Starts the pinned OpenCode server library on loopback with Basic authentication.`;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    hostname: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "0" },
    cors: { type: "string", multiple: true, default: [] },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});
if (values.help) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  process.stderr.write(`Invalid port: ${values.port}\n`);
  process.exit(2);
}

let stop: Deferred.Deferred<void> | undefined;
let stopRequested = false;
let completeStop: (() => void) | undefined;
const requestStop = (): void => {
  stopRequested = true;
  completeStop?.();
};
process.on("SIGTERM", requestStop);
process.on("SIGINT", requestStop);
// Handlers are installed before this line; tests synchronize on it.
process.stdout.write("server starting\n");

const envPassword = process.env.OPENCODE_SERVER_PASSWORD;
const password = envPassword || randomBytes(32).toString("base64url");

const configuredDatabase = process.env.OPENCODE_DB;
const database =
  configuredDatabase === ":memory:"
    ? { path: ":memory:" }
    : {
        path: configuredDatabase
          ? isAbsolute(configuredDatabase)
            ? configuredDatabase
            : resolve(Global.Path.data, configuredDatabase)
          : resolve(Global.Path.data, "opencode.db"),
      };

type OpenCodeConfigOptions = {
  project: boolean;
  directory?: string;
  file?: string;
  content?: string;
};
const config: OpenCodeConfigOptions = { project: true };
if (process.env.OPENCODE_CONFIG_DIR) config.directory = process.env.OPENCODE_CONFIG_DIR;
if (process.env.OPENCODE_CONFIG) config.file = process.env.OPENCODE_CONFIG;
if (process.env.OPENCODE_CONFIG_CONTENT) config.content = process.env.OPENCODE_CONFIG_CONTENT;

// Fall back to a warning when the pinned PTY package has no binary for this platform.
async function configurePty(): Promise<void> {
  if (process.env.OPENCODE_PTY_BIN) return;
  try {
    const { binaryPath } = await import("@opencode-ai/pty");
    if (binaryPath) process.env.OPENCODE_PTY_BIN = binaryPath;
    else process.stderr.write("Persistent PTY is unavailable on this platform.\n");
  } catch {
    process.stderr.write("Persistent PTY is unavailable; set OPENCODE_PTY_BIN to enable it.\n");
  }
}
await configurePty();

stop = Deferred.makeUnsafe<void>();
completeStop = () => Deferred.doneUnsafe(stop, Effect.void);
if (stopRequested) completeStop();

const program = Effect.gen(function* () {
  const started = yield* ServerProcess.start<never, never>({
    hostname: values.hostname,
    port,
    password,
    cors: values.cors,
    app: { name: "oc-ui", version: OPENCODE_VERSION },
    database,
    config,
  });
  if (started.address._tag !== "TcpAddress") return yield* Effect.die("Unexpected listen address");
  const hostname = started.address.hostname.includes(":")
    ? `[${started.address.hostname}]`
    : started.address.hostname;
  process.stdout.write(`server listening on http://${hostname}:${started.address.port}\n`);
  if (!envPassword) process.stdout.write(`server password ${password}\n`);
  return yield* Effect.never;
});

const exit = await Effect.runPromiseExit(
  Effect.scoped(program).pipe(
    Effect.raceFirst(Deferred.await(stop).pipe(Effect.andThen(Effect.interrupt))),
  ),
);
if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) process.exit(0);
console.error("OpenCode server failed to start.", Cause.pretty(exit.cause));
process.exit(1);
