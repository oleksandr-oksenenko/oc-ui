// @vitest-environment node
import { EventEmitter } from "node:events";

import type { ServerProcess } from "@opencode-ai/server/process";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  OpenCodeWorkerCommand,
  OpenCodeWorkerMessage,
} from "../shared/opencode-worker-contract.ts";
import type { configureOpenCodeLaunch } from "./opencode-launch-settings.ts";

const mocks = vi.hoisted(() => ({
  start:
    vi.fn<
      (
        options: Parameters<typeof ServerProcess.start>[0],
        lifecycle: ServerProcess.Lifecycle,
      ) => ReturnType<typeof ServerProcess.start>
    >(),
  configure: vi.fn<typeof configureOpenCodeLaunch>(),
}));
const exitProcess = vi.fn<(code?: number | string | null) => void>();
vi.mock("@opencode-ai/server/process", () => ({ ServerProcess: { start: mocks.start } }));
vi.mock("./opencode-launch-settings.ts", () => ({ configureOpenCodeLaunch: mocks.configure }));

class Parent extends EventEmitter {
  postMessage = vi.fn<(message: OpenCodeWorkerMessage) => void>();
  command(data: OpenCodeWorkerCommand): void {
    this.emit("message", { data });
  }
}
let parent: Parent;
let originalParent: PropertyDescriptor | undefined;
let originalExit: PropertyDescriptor | undefined;
let originalSignals: ReturnType<typeof process.listeners>;
const address = { _tag: "TcpAddress" as const, hostname: "127.0.0.1", port: 4096 };
const startCommand: OpenCodeWorkerCommand = {
  type: "start",
  userDataPath: "/private/test-ocui",
  password: "worker-test-secret",
};
const settings = {
  database: { path: "/test/shared/opencode.db" },
  config: { directory: "/private/test-ocui/opencode/config", project: true, content: "{}" },
};

beforeEach(() => {
  vi.resetModules();
  mocks.start.mockReset();
  mocks.configure.mockReset().mockResolvedValue(settings);
  parent = new Parent();
  originalParent = Object.getOwnPropertyDescriptor(process, "parentPort");
  Object.defineProperty(process, "parentPort", { configurable: true, value: parent });
  originalSignals = process.listeners("SIGTERM");
  originalExit = Object.getOwnPropertyDescriptor(process, "exit");
  exitProcess.mockClear();
  Object.defineProperty(process, "exit", { configurable: true, value: exitProcess });
});

afterEach(() => {
  if (originalExit !== undefined) Object.defineProperty(process, "exit", originalExit);
  if (originalParent === undefined) Reflect.deleteProperty(process, "parentPort");
  else Object.defineProperty(process, "parentPort", originalParent);
  for (const listener of process.listeners("SIGTERM")) {
    if (!originalSignals.includes(listener)) process.off("SIGTERM", listener);
  }
  vi.restoreAllMocks();
});

describe("OpenCode worker scope ownership", () => {
  it("starts the public library once and closes its scope, not the returned shutdown waiter", async () => {
    const finalized = vi.fn<() => void>();
    const signaled = vi.fn<() => void>();
    mocks.start.mockImplementation((_options, lifecycle) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(finalized));
        const cleanup = yield* lifecycle.onListen(address, Effect.sync(signaled));
        yield* Effect.addFinalizer(() => cleanup);
        return { address, shutdown: Effect.never };
      }),
    );
    await import("./opencode-worker.ts");
    parent.command(startCommand);
    await vi.waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith({
        type: "listening",
        url: "http://127.0.0.1:4096",
      }),
    );
    expect(mocks.start).toHaveBeenCalledWith(
      {
        ...settings,
        hostname: "127.0.0.1",
        port: 0,
        password: "worker-test-secret",
        app: { name: "oc-ui", version: "0.0.0-beta-18866" },
      },
      expect.objectContaining({ onListen: expect.any(Function) }),
    );
    expect(finalized).not.toHaveBeenCalled();
    parent.command({ type: "stop" });
    parent.command({ type: "stop" });
    await vi.waitFor(() => expect(exitProcess).toHaveBeenCalledExactlyOnceWith(0));
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(signaled).toHaveBeenCalledTimes(1);
  });

  it("remembers stop during asynchronous import preparation and never starts afterward", async () => {
    let finish!: (value: typeof settings) => void;
    mocks.configure.mockReturnValue(
      new Promise<typeof settings>((resolve) => {
        finish = resolve;
      }),
    );
    await import("./opencode-worker.ts");
    parent.command(startCommand);
    parent.command({ type: "stop" });
    expect(exitProcess).not.toHaveBeenCalled();
    finish(settings);
    await vi.waitFor(() => expect(exitProcess).toHaveBeenCalledWith(0));
    expect(mocks.start).not.toHaveBeenCalled();
    parent.command(startCommand);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("interrupts an unfinished boot and runs its scope finalizers once", async () => {
    const finalized = vi.fn<() => void>();
    mocks.start.mockImplementation((_options, lifecycle) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(finalized));
        const cleanup = yield* lifecycle.onListen(address, Effect.void);
        yield* Effect.addFinalizer(() => cleanup);
        return yield* Effect.never;
      }),
    );
    await import("./opencode-worker.ts");
    parent.command(startCommand);
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    parent.command({ type: "stop" });
    await vi.waitFor(() => expect(exitProcess).toHaveBeenCalledWith(0));
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "fatal" }));
  });

  it("reports only a sanitized boot failure and still closes the acquired scope", async () => {
    const finalized = vi.fn<() => void>();
    mocks.start.mockImplementation(() =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(finalized));
        return yield* Effect.fail("sensitive provider token");
      }),
    );
    await import("./opencode-worker.ts");
    parent.command(startCommand);
    await vi.waitFor(() => expect(exitProcess).toHaveBeenCalledWith(0));
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "fatal",
      message: "Built-in OpenCode failed.",
    });
    expect(finalized).toHaveBeenCalledTimes(1);
  });

  it("does not claim a clean exit when scope cleanup fails", async () => {
    const finalized = vi.fn<() => void>();
    mocks.start.mockImplementation((_options, lifecycle) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(finalized).pipe(Effect.andThen(Effect.die("cleanup failed"))),
        );
        const cleanup = yield* lifecycle.onListen(address, Effect.void);
        yield* Effect.addFinalizer(() => cleanup);
        return { address, shutdown: Effect.never };
      }),
    );
    await import("./opencode-worker.ts");
    parent.command(startCommand);
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    parent.command({ type: "stop" });
    await vi.waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith({
        type: "fatal",
        message: "Built-in OpenCode failed.",
      }),
    );
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(exitProcess).not.toHaveBeenCalled();
  });
});
