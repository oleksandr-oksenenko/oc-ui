// @vitest-environment node
import { EventEmitter } from "node:events";

import type { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { OpenCodeWorkerCommand } from "../shared/opencode-worker-contract.ts";
import { LocalOpenCode, LOCAL_OPENCODE_VERSION } from "./local-opencode.ts";

const { fork } = vi.hoisted(() => ({ fork: vi.fn<typeof utilityProcess.fork>() }));
const killProcess = vi.fn<typeof process.kill>();
const fetchMock = vi.fn<typeof fetch>();
vi.mock("electron", () => ({ utilityProcess: { fork } }));

class Child extends EventEmitter implements UtilityProcess {
  pid: number | undefined = 4242;
  stdout = null;
  stderr = null;
  exitsOnStop = true;
  kill = vi.fn<() => boolean>(() => true);
  postMessage = vi.fn<(message: OpenCodeWorkerCommand) => void>((message) => {
    if (message.type === "stop" && this.exitsOnStop) queueMicrotask(() => this.exit());
  });

  exit(): void {
    this.emit("exit", 0);
    this.pid = undefined;
  }

  listen(url = "http://127.0.0.1:4096"): void {
    this.emit("spawn");
    this.emit("message", { type: "listening", url });
  }
}

const children: Child[] = [];
const healthy = (pid = 4242, version = LOCAL_OPENCODE_VERSION): Response =>
  Response.json({ healthy: true, version, pid });
const runtimes: ManagedRuntime.ManagedRuntime<LocalOpenCode, never>[] = [];
const create = async (options: { inspectorPort?: string } = {}) => {
  const runtime = ManagedRuntime.make(
    LocalOpenCode.layer({
      userDataPath: "/private/test-ocui",
      workerPath: "/private/runtime/opencode-worker.mjs",
      inspectorPort: options.inspectorPort,
    }),
  );
  runtimes.push(runtime);
  const service = await runtime.runPromise(LocalOpenCode);
  return {
    connect: (signal?: AbortSignal) => runtime.runPromise(service.connect, { signal }),
    needsQuitConfirmation: () => Effect.runSync(service.needsQuitConfirmation),
    shutdown: () => runtime.runPromise(service.shutdown),
    onUnavailable: service.onUnavailable,
    dispose: () => runtime.dispose(),
  };
};
const child = (): Child => {
  const value = children.at(-1);
  if (value === undefined) throw new Error("No worker was forked");
  return value;
};

beforeEach(() => {
  fork.mockImplementation(() => {
    const value = new Child();
    children.push(value);
    return value;
  });
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(healthy()));
  vi.stubGlobal("fetch", fetchMock);
  killProcess.mockReturnValue(true);
  vi.spyOn(process, "kill").mockImplementation(killProcess);
});

afterEach(async () => {
  for (const value of children) if (value.pid !== undefined) value.exit();
  for (const runtime of runtimes) await runtime.dispose();
  runtimes.length = 0;
  children.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("owned OpenCode worker", () => {
  it("starts lazily, shares concurrent starts, and reuses the same authenticated endpoint", async () => {
    const service = await create();
    expect(service.needsQuitConfirmation()).toBe(false);
    expect(fork).not.toHaveBeenCalled();
    const first = service.connect();
    const second = service.connect();
    expect(service.needsQuitConfirmation()).toBe(true);
    expect(fork).toHaveBeenCalledExactlyOnceWith("/private/runtime/opencode-worker.mjs", [], {
      serviceName: "Ocui built-in OpenCode",
      stdio: "pipe",
    });
    child().listen();
    const endpoint = await first;
    expect(await second).toBe(endpoint);
    expect(endpoint.serverUrl).toBe("http://127.0.0.1:4096");
    expect(endpoint.password.length).toBeGreaterThan(32);
    expect(child().postMessage).toHaveBeenCalledWith({
      type: "start",
      userDataPath: "/private/test-ocui",
      password: endpoint.password,
    });
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toEqual(new URL("http://127.0.0.1:4096/api/health"));
    expect(new Headers(request?.[1]?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
    );
    expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(await service.connect()).toBe(endpoint);
    expect(fork).toHaveBeenCalledTimes(1);
    const shutdown = service.shutdown();
    const concurrentShutdown = service.shutdown();
    await Promise.all([shutdown, concurrentShutdown]);
    expect(service.needsQuitConfirmation()).toBe(false);
    await expect(service.connect()).rejects.toMatchObject({ reason: "start-failed" });
  });

  it("forwards a development inspector port to the built-in worker", async () => {
    const service = await create({ inspectorPort: "9230" });
    const connected = service.connect();
    expect(fork).toHaveBeenCalledExactlyOnceWith("/private/runtime/opencode-worker.mjs", [], {
      serviceName: "Ocui built-in OpenCode",
      stdio: "pipe",
      execArgv: ["--inspect=9230"],
    });
    child().listen();
    await connected;
    await service.shutdown();
  });

  it("keeps shared startup alive when one caller cancels its wait", async () => {
    const service = await create();
    const controller = new AbortController();
    const canceled = service.connect(controller.signal);
    const connected = service.connect();
    controller.abort();
    await expect(canceled).rejects.toBeDefined();
    expect(child().postMessage).not.toHaveBeenCalledWith({ type: "stop" });
    child().listen();
    await connected;
    expect(fork).toHaveBeenCalledTimes(1);
    expect(service.needsQuitConfirmation()).toBe(true);
    await service.shutdown();
  });

  it("waits for actual child exit when the application scope is disposed", async () => {
    const service = await create();
    const connected = service.connect();
    child().listen();
    await connected;
    child().exitsOnStop = false;
    const disposed = vi.fn<() => void>();
    const disposal = service.dispose().then(disposed);
    await vi.waitFor(() => expect(child().postMessage).toHaveBeenCalledWith({ type: "stop" }));
    expect(disposed).not.toHaveBeenCalled();
    expect(service.needsQuitConfirmation()).toBe(true);
    child().exit();
    await disposal;
    expect(service.needsQuitConfirmation()).toBe(false);
  });

  it("does not treat listening or HTTP 503 as readiness", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    const service = await create();
    const connected = service.connect();
    const resolved = vi.fn<() => void>();
    void connected.then(resolved);
    child().listen();
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    await connected;
    expect(fetch).toHaveBeenCalledTimes(2);
    await service.shutdown();
  });

  it.each([
    [
      "HTTP 500 even with healthy true",
      () =>
        Response.json(
          { healthy: true, version: LOCAL_OPENCODE_VERSION, pid: 4242 },
          { status: 500 },
        ),
    ],
    ["another process PID", () => healthy(9999)],
    ["another version", () => Response.json({ healthy: true, version: "wrong", pid: 4242 })],
    ["unauthenticated health", () => new Response(null, { status: 401 })],
  ])("rejects %s and waits for the owned child to exit", async (_name, response) => {
    vi.mocked(fetch).mockResolvedValue(response());
    const service = await create();
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "start-failed" });
    })();
    child().listen();
    await rejected;
    expect(child().postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(service.needsQuitConfirmation()).toBe(false);
  });

  it("rejects a non-loopback or malformed private message without probing it", async () => {
    const service = await create();
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "invalid-endpoint" });
    })();
    child().listen("http://example.test:4096");
    await rejected;
    expect(fetch).not.toHaveBeenCalled();
    expect(service.needsQuitConfirmation()).toBe(false);
  });

  it("cancels an in-flight readiness fetch immediately when quitting", async () => {
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const service = await create();
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "start-failed" });
    })();
    child().listen();
    await vi.waitFor(() => expect(signal?.aborted).toBe(false));
    const quitting = service.shutdown();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(child().postMessage).toHaveBeenCalledWith({ type: "stop" });
    await Promise.all([quitting, rejected]);
    expect(child().kill).not.toHaveBeenCalled();
  });

  it("preempts startup before the child spawn notification", async () => {
    const service = await create();
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "start-failed" });
    })();
    const quitting = service.shutdown();
    child().emit("spawn");
    await Promise.all([quitting, rejected]);
    expect(child().postMessage).toHaveBeenCalledExactlyOnceWith({ type: "stop" });
  });

  it("caps an individual health request at two seconds", async () => {
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const service = await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "start-failed" });
    })();
    child().listen();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signal?.aborted).toBe(true);
    expect(service.needsQuitConfirmation()).toBe(true);
    await Promise.all([service.shutdown(), rejected]);
  });

  it("times out an unresponsive import and cancels the current health request at the overall deadline", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          if (init?.signal === undefined || init.signal === null) throw new Error("Missing signal");
          signals.push(init.signal);
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const service = await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = service.connect();
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "timed-out" });
    })();
    await vi.advanceTimersByTimeAsync(29_000);
    child().listen();
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(service.needsQuitConfirmation()).toBe(false);
  });

  it("does not automatically restart a crash and ignores late events from the previous worker", async () => {
    const service = await create();
    const unavailable = vi.fn<() => void>();
    service.onUnavailable(unavailable);
    const initial = service.connect();
    const previous = child();
    const oldMessage = previous.listeners("message")[0];
    const oldExit = previous.listeners("exit")[0];
    previous.listen();
    await initial;
    previous.exit();
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1));
    expect(fork).toHaveBeenCalledTimes(1);
    const restarted = service.connect();
    oldMessage?.({ type: "fatal", message: "Built-in OpenCode failed." });
    oldExit?.(1);
    child().listen();
    await restarted;
    expect(service.needsQuitConfirmation()).toBe(true);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledTimes(2);
    await service.shutdown();
  });

  it("rejects an early exit and permits only a fresh manual start afterward", async () => {
    const service = await create();
    const initial = service.connect();
    const rejected = (async () => {
      await expect(initial).rejects.toMatchObject({ reason: "start-failed" });
    })();
    child().exit();
    await rejected;
    expect(fork).toHaveBeenCalledTimes(1);
    const restarted = service.connect();
    child().listen();
    await restarted;
    await service.shutdown();
  });

  it("retains a child after failed termination and retries that same child on the next quit", async () => {
    const service = await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = service.connect();
    child().listen();
    await connected;
    child().exitsOnStop = false;
    const quitting = service.shutdown();
    const rejected = (async () => {
      await expect(quitting).rejects.toMatchObject({ reason: "stop-failed" });
    })();
    await vi.advanceTimersByTimeAsync(14_000);
    await rejected;
    expect(child().kill).toHaveBeenCalledTimes(1);
    expect(killProcess).toHaveBeenCalledExactlyOnceWith(4242, "SIGKILL");
    expect(service.needsQuitConfirmation()).toBe(true);
    await expect(service.connect()).rejects.toMatchObject({ reason: "start-failed" });
    expect(fork).toHaveBeenCalledTimes(1);
    child().exitsOnStop = true;
    await service.shutdown();
    expect(service.needsQuitConfirmation()).toBe(false);
  });

  it("keeps a failed startup owned when its cleanup fails", async () => {
    const service = await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = service.connect();
    child().exitsOnStop = false;
    const rejected = (async () => {
      await expect(connected).rejects.toMatchObject({ reason: "stop-failed" });
    })();
    child().emit("message", { type: "fatal", message: "Built-in OpenCode failed." });
    await vi.waitFor(() => expect(child().postMessage).toHaveBeenCalledWith({ type: "stop" }));
    await vi.advanceTimersByTimeAsync(14_000);
    await rejected;
    await expect(service.connect()).rejects.toMatchObject({ reason: "stop-failed" });
    expect(fork).toHaveBeenCalledTimes(1);
    expect(service.needsQuitConfirmation()).toBe(true);
    child().exitsOnStop = true;
    await service.shutdown();
  });

  it("cancels force-kill escalation once Electron confirms exit after TERM", async () => {
    const service = await create();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const connected = service.connect();
    child().listen();
    await connected;
    child().exitsOnStop = false;
    child().kill.mockImplementation(() => {
      child().exit();
      return true;
    });
    const quitting = service.shutdown();
    await vi.advanceTimersByTimeAsync(10_000);
    await quitting;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(child().kill).toHaveBeenCalledTimes(1);
    expect(killProcess).not.toHaveBeenCalled();
    expect(service.needsQuitConfirmation()).toBe(false);
  });
});
