import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createProfile(prefix, sourceEnv = process.env) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const paths = Object.fromEntries(
    ["home", "data", "state", "cache", "config", "tmp", "app", "runtime"].map((name) => [
      name,
      join(root, name),
    ]),
  );
  await Promise.all(
    Object.values(paths).map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
  );
  // Only the display and explicitly owned dbus-run-session bus cross the profile
  // boundary. Never inherit the caller's keyring socket or XDG runtime directory.
  const sessionEnv = Object.fromEntries(
    ["DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"]
      .filter((key) => sourceEnv[key] !== undefined)
      .map((key) => [key, sourceEnv[key]]),
  );
  return {
    root,
    paths,
    env: {
      ...sessionEnv,
      PATH: sourceEnv.PATH,
      HOME: paths.home,
      TMPDIR: paths.tmp,
      SHELL: process.platform === "darwin" ? "/bin/zsh" : "/bin/bash",
      LANG: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8",
      XDG_DATA_HOME: paths.data,
      XDG_STATE_HOME: paths.state,
      XDG_CACHE_HOME: paths.cache,
      XDG_CONFIG_HOME: paths.config,
      XDG_RUNTIME_DIR: paths.runtime,
      OPENCODE_DB: join(paths.data, "acceptance.db"),
    },
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/** The runner owns this foreground daemon until all app processes have stopped. */
export async function startSecretService(
  profile,
  signal,
  { spawn: spawnCommand = spawn, execFile: runCommand = execFileAsync } = {},
) {
  signal.throwIfAborted();
  if (!profile.env.DBUS_SESSION_BUS_ADDRESS) {
    throw new Error("Linux packaged acceptance must run under dbus-run-session");
  }
  await mkdir(join(profile.paths.runtime, "keyring"), { mode: 0o700 });
  const log = await open(join(profile.root, "secret-service.log"), "w", 0o600);
  let child;
  try {
    child = spawnCommand(
      "gnome-keyring-daemon",
      [
        "--foreground",
        "--unlock",
        "--components=secrets",
        `--control-directory=${join(profile.paths.runtime, "keyring")}`,
      ],
      { env: profile.env, stdio: ["pipe", log.fd, log.fd] },
    );
  } catch (cause) {
    await log.close();
    throw cause;
  }
  let settled = false;
  const exited = new Promise((resolve) => {
    child.once("error", (cause) => {
      settled = true;
      resolve(cause);
    });
    child.once("exit", (code, exitSignal) => {
      settled = true;
      resolve(new Error(`Secret Service exited: ${exitSignal ?? code ?? "unknown"}`));
    });
  });
  // --unlock consumes password bytes through EOF, without an interactive prompt.
  child.stdin.on("error", () => {}); // Startup failure is reported by exit/readiness below.
  child.stdin.end(randomBytes(32).toString("hex"));
  const close = async () => {
    try {
      for (const stopSignal of ["SIGTERM", "SIGKILL"]) {
        if (settled) break;
        child.kill(stopSignal);
        let timeout;
        try {
          await Promise.race([
            exited,
            new Promise((resolve) => {
              timeout = setTimeout(resolve, 10_000);
              timeout.unref();
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (!settled) throw new Error("Owned Secret Service did not stop");
    } finally {
      await log.close();
    }
  };
  const startup = new AbortController();
  const options = {
    env: profile.env,
    signal: AbortSignal.any([signal, startup.signal]),
    timeout: 20_000,
  };
  const ready = (async () => {
    await runCommand("gdbus", ["wait", "--session", "org.freedesktop.secrets"], options);
    const busDestination = [
      "call",
      "--session",
      "--timeout",
      "10",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
    ];
    const ownerResponse = await runCommand(
      "gdbus",
      [...busDestination, "org.freedesktop.DBus.GetNameOwner", "org.freedesktop.secrets"],
      options,
    );
    const owner = /^\('(:[0-9]+\.[0-9]+)',\)$/u.exec(ownerResponse.stdout.trim())?.[1];
    if (owner === undefined) throw new Error("Invalid Secret Service D-Bus owner");
    const pidResponse = await runCommand(
      "gdbus",
      [...busDestination, "org.freedesktop.DBus.GetConnectionUnixProcessID", owner],
      options,
    );
    const ownerPid = /^\(uint32 ([0-9]+),\)$/u.exec(pidResponse.stdout.trim())?.[1];
    if (ownerPid === undefined || Number(ownerPid) !== child.pid) {
      throw new Error("Secret Service D-Bus owner is not the owned daemon");
    }
    // Pin subsequent calls to the verified unique connection, so replacement of
    // the well-known name cannot redirect mutations to another user's service.
    const destination = ["--session", "--timeout", "10", "--dest", owner];
    await runCommand(
      "gdbus",
      [
        "call",
        ...destination,
        "--object-path",
        "/org/freedesktop/secrets",
        "--method",
        "org.freedesktop.Secret.Service.SetAlias",
        "default",
        "/org/freedesktop/secrets/collection/login",
      ],
      options,
    );
    const { stdout } = await runCommand(
      "gdbus",
      [
        "call",
        ...destination,
        "--object-path",
        "/org/freedesktop/secrets/collection/login",
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.Secret.Collection",
        "Locked",
      ],
      options,
    );
    if (stdout.trim() !== "(<false>,)")
      throw new Error("Disposable Secret Service collection is locked");
  })();
  try {
    await Promise.race([
      ready,
      exited.then((cause) => {
        throw cause;
      }),
    ]);
    signal.throwIfAborted();
    if (settled) throw await exited;
    return {
      close: async () => {
        const earlyExit = settled ? await exited : undefined;
        await close();
        if (earlyExit !== undefined) throw earlyExit;
      },
    };
  } catch (cause) {
    startup.abort();
    await ready.catch(() => {});
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], "Secret Service startup and cleanup failed", {
        cause: cleanup,
      });
    }
    throw cause;
  }
}
