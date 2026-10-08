// @vitest-environment node
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { createProfile, startSecretService } from "./e2e/profile.mjs";

it("retains the display and owned session bus without inheriting credentials or profile paths", async () => {
  const profile = await createProfile("ocui-profile-unit-", {
    PATH: "/usr/bin:/bin",
    DISPLAY: ":99",
    XAUTHORITY: "/fixture/xauthority",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture/bus",
    HOME: "/real/home",
    XDG_RUNTIME_DIR: "/real/runtime",
    GNOME_KEYRING_CONTROL: "/real/keyring",
    SSH_AUTH_SOCK: "/real/ssh",
    OPENCODE_API_KEY: "real-provider-secret",
    AWS_SECRET_ACCESS_KEY: "real-cloud-secret",
    OCUI_E2E_APP_BINARY_PATH: "/untrusted/app",
  });
  try {
    expect(profile.env).toMatchObject({
      PATH: "/usr/bin:/bin",
      DISPLAY: ":99",
      XAUTHORITY: "/fixture/xauthority",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture/bus",
      HOME: profile.paths.home,
      XDG_RUNTIME_DIR: profile.paths.runtime,
      XDG_DATA_HOME: profile.paths.data,
      XDG_CONFIG_HOME: profile.paths.config,
    });
    for (const key of [
      "GNOME_KEYRING_CONTROL",
      "SSH_AUTH_SOCK",
      "OPENCODE_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "OCUI_E2E_APP_BINARY_PATH",
    ])
      expect(profile.env).not.toHaveProperty(key);
    expect((await stat(profile.paths.runtime)).mode & 0o777).toBe(0o700);
  } finally {
    await profile.remove();
  }
});

function daemon() {
  const child = new EventEmitter();
  child.pid = 42_000;
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  child.kill = vi.fn((signal) => {
    child.emit("exit", null, signal);
    return true;
  });
  return child;
}

function secretServiceCalls(child, { locked = false, ownerPid = child.pid } = {}) {
  return vi.fn(async (_command, args) => {
    if (args.includes("org.freedesktop.DBus.GetNameOwner")) return { stdout: "(':1.42',)\n" };
    if (args.includes("org.freedesktop.DBus.GetConnectionUnixProcessID")) {
      return { stdout: `(uint32 ${ownerPid},)\n` };
    }
    if (args.includes("org.freedesktop.DBus.Properties.Get")) return { stdout: `(<${locked}>,)\n` };
    return { stdout: "()\n" };
  });
}

it("stops its daemon and retains diagnostics when Secret Service startup fails", async () => {
  const profile = await createProfile("ocui-keyring-failure-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const child = daemon();
  const failure = new Error("gdbus readiness failed");
  try {
    await expect(
      startSecretService(profile, new AbortController().signal, {
        spawn: () => child,
        execFile: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(child.stdin.end.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/u);
    expect((await stat(join(profile.root, "secret-service.log"))).isFile()).toBe(true);
  } finally {
    await profile.remove();
  }
});

it("owns a ready daemon until explicit teardown", async () => {
  const profile = await createProfile("ocui-keyring-owner-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const child = daemon();
  const spawn = vi.fn(() => child);
  const runCommand = secretServiceCalls(child);
  try {
    const service = await startSecretService(profile, new AbortController().signal, {
      spawn,
      execFile: runCommand,
    });
    expect(spawn.mock.calls[0][1]).toContain("--foreground");
    expect(spawn.mock.calls[0][1]).not.toContain("--start");
    expect(child.kill).not.toHaveBeenCalled();
    const pinnedCalls = runCommand.mock.calls.filter(
      ([_command, args]) =>
        args.includes("org.freedesktop.Secret.Service.SetAlias") ||
        args.includes("org.freedesktop.DBus.Properties.Get"),
    );
    expect(pinnedCalls).toHaveLength(2);
    for (const [_command, args] of pinnedCalls) {
      expect(args[args.indexOf("--dest") + 1]).toBe(":1.42");
    }
    await service.close();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  } finally {
    await profile.remove();
  }
});

it("refuses a locked Secret Service collection and stops the daemon", async () => {
  const profile = await createProfile("ocui-keyring-locked-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const locked = daemon();
  try {
    await expect(
      startSecretService(profile, new AbortController().signal, {
        spawn: () => locked,
        execFile: secretServiceCalls(locked, { locked: true }),
      }),
    ).rejects.toThrow("collection is locked");
    expect(locked.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  } finally {
    await profile.remove();
  }
});

it("rejects a foreign Secret Service owner without alias mutation and stops only its daemon", async () => {
  const profile = await createProfile("ocui-keyring-foreign-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/user/desktop-bus",
  });
  const child = daemon();
  const runCommand = secretServiceCalls(child, { ownerPid: child.pid + 1 });
  try {
    await expect(
      startSecretService(profile, new AbortController().signal, {
        spawn: () => child,
        execFile: runCommand,
      }),
    ).rejects.toThrow("owner is not the owned daemon");
    expect(
      runCommand.mock.calls.some(([_command, args]) =>
        args.includes("org.freedesktop.Secret.Service.SetAlias"),
      ),
    ).toBe(false);
    expect(
      runCommand.mock.calls.some(([_command, args]) =>
        args.includes("org.freedesktop.DBus.Properties.Get"),
      ),
    ).toBe(false);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  } finally {
    await profile.remove();
  }
});

it("awaits a delayed daemon exit before completing teardown", async () => {
  const profile = await createProfile("ocui-keyring-delayed-exit-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const child = daemon();
  let closing;
  try {
    const service = await startSecretService(profile, new AbortController().signal, {
      spawn: () => child,
      execFile: secretServiceCalls(child),
    });
    vi.useFakeTimers();
    child.kill.mockImplementation((signal) => {
      setTimeout(() => child.emit("exit", null, signal), 500);
      return true;
    });
    let closed = false;
    closing = service.close().then(() => {
      closed = true;
      return closed;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(closed).toBe(false);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    child.emit("exit", null, "SIGKILL");
    await closing;
    vi.useRealTimers();
    await profile.remove();
  }
});

it("escalates an ignored SIGTERM to SIGKILL and awaits the resulting exit", async () => {
  const profile = await createProfile("ocui-keyring-escalation-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const child = daemon();
  let closing;
  try {
    const service = await startSecretService(profile, new AbortController().signal, {
      spawn: () => child,
      execFile: secretServiceCalls(child),
    });
    vi.useFakeTimers();
    child.kill.mockImplementation((signal) => {
      if (signal === "SIGKILL") setTimeout(() => child.emit("exit", null, signal), 500);
      return true;
    });
    let closed = false;
    closing = service.close().then(() => {
      closed = true;
      return closed;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    await vi.advanceTimersByTimeAsync(499);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    child.emit("exit", null, "SIGKILL");
    await closing;
    vi.useRealTimers();
    await profile.remove();
  }
});

it("cancels the readiness command and awaits daemon teardown on interruption", async () => {
  const profile = await createProfile("ocui-keyring-interrupt-", {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned/bus",
  });
  const child = daemon();
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const interrupted = new Error("interrupted");
  try {
    const service = startSecretService(profile, controller.signal, {
      spawn: () => child,
      execFile: (_command, _args, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
          started.resolve();
        }),
    });
    const rejection = expect(service).rejects.toBe(interrupted);
    await started.promise;
    controller.abort(interrupted);
    await rejection;
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  } finally {
    await profile.remove();
  }
});
