// @vitest-environment node
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { Browser } from "@opencode/plugin-browser/rpc";
import { SessionID } from "@opencode-ai/schema/session-id";
import { Deferred, Effect, ManagedRuntime, Queue, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { emptyBrowserState, type BrowserEvent } from "../../shared/browser-api.ts";
import type { NativeBrowser } from "./native.ts";
import { BrowserHost } from "./host.ts";

const native = {
  state: emptyBrowserState,
  execute: vi.fn<NativeBrowser["execute"]>(),
  layout: vi.fn<NativeBrowser["layout"]>(),
  hide: vi.fn<NativeBrowser["hide"]>(),
  dispose: vi.fn<NativeBrowser["dispose"]>(),
};

type Reply = { outcome: typeof Browser.Outcome.Encoded };
type Rpc = {
  attach: () => Effect.Effect<"closed" | "replaced">;
  state: () => Effect.Effect<void>;
  command: () => Effect.Effect<Browser.Command>;
  result: (reply: Reply) => Effect.Effect<void>;
};
let rpc: Rpc;
let controls: Queue.Queue<
  { type: "server.connected" } | { type: "rpc.experimental.browser.control"; data: Browser.Control }
>;
vi.mock("@opencode-ai/client/effect", () => ({
  OpenCode: {
    make: () =>
      Effect.succeed({
        session: { get: () => Effect.succeed({ location: { directory: "/project" } }) },
        event: { subscribe: () => Stream.fromQueue(controls) },
        rpc: () => rpc,
      }),
  },
}));
vi.mock("./network.ts", () => ({ createBrowserNetwork: () => Effect.void }));
vi.mock("./native.ts", () => ({ createNativeBrowser: () => native }));

let runtime: ManagedRuntime.ManagedRuntime<BrowserHost, never>;
let host: BrowserHost["Service"];
let closed: Deferred.Deferred<"closed" | "replaced">;
let window: BrowserWindow;
let events: BrowserEvent[];
let replies: Reply[];
const input = {
  bindingID: "fixture",
  sessionID: SessionID.make("ses_fixture"),
  serverUrl: "http://localhost:1234",
  password: "",
};
const control = (data: Browser.Control) =>
  Queue.offerUnsafe(controls, { type: "rpc.experimental.browser.control", data });
const start = () =>
  runtime.runPromiseExit(host.attach(window, input, (event) => events.push(event)));

beforeEach(async () => {
  controls = Effect.runSync(Queue.unbounded());
  Queue.offerUnsafe(controls, { type: "server.connected" });
  closed = Deferred.makeUnsafe();
  events = [];
  replies = [];
  // SAFETY: Native page creation is mocked; the host only uses these window events and destruction check.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal Electron fixture; native creation is mocked.
  window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: () => false,
  }) as BrowserWindow;
  vi.resetAllMocks();
  native.execute.mockResolvedValue({ value: emptyBrowserState(), files: [] });
  native.dispose.mockResolvedValue(undefined);
  rpc = {
    attach: vi.fn<Rpc["attach"]>(() =>
      Effect.sync(() =>
        control({ type: "attached", connectionID: input.bindingID, version: 4 }),
      ).pipe(Effect.andThen(Deferred.await(closed))),
    ),
    state: () => Effect.void,
    command: () => Effect.succeed({ action: { type: "tabs.list" }, files: [] }),
    result: (reply) =>
      Effect.sync(() => {
        replies.push(reply);
      }),
  };
  runtime = ManagedRuntime.make(BrowserHost.layer);
  host = await runtime.runPromise(BrowserHost);
});
afterEach(async () => {
  await runtime.dispose();
});

describe("browser attachment lifetime", () => {
  it("keeps attach pending after readiness and publishes state before command results", async () => {
    const acknowledged = Deferred.makeUnsafe<void>();
    rpc.state = () => Deferred.await(acknowledged);
    let settled = false;
    const lifetime = start().then(() => {
      settled = true;
      return undefined;
    });
    await vi.waitFor(() => expect(rpc.attach).toHaveBeenCalledOnce());
    control({ type: "command", connectionID: input.bindingID, requestID: "request" });
    await vi.waitFor(() => expect(native.execute).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(replies).toHaveLength(0);
    await Effect.runPromise(Deferred.succeed(acknowledged, undefined));
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(events[0]).toMatchObject({ status: "connected" });
    await runtime.runPromise(host.detach(window, input.bindingID));
    await lifetime;
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ status: "closed" });
  });

  it("waits for pending setup cleanup before settling attach and detach callers", async () => {
    rpc.attach = vi.fn<Rpc["attach"]>(() => Deferred.await(closed));
    const disposal = Promise.withResolvers<void>();
    native.dispose.mockReturnValue(disposal.promise);
    const lifetime = start();
    let settled = false;
    await vi.waitFor(() => expect(rpc.attach).toHaveBeenCalledOnce());
    const detach = runtime.runPromise(host.detach(window, input.bindingID)).then(() => {
      settled = true;
      return undefined;
    });
    await vi.waitFor(() => expect(native.dispose).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(events).toEqual([]);
    disposal.resolve();
    await Promise.all([lifetime, detach]);
    expect(events.at(-1)).toMatchObject({ status: "closed" });
  });

  it("signals an in-flight command and waits for its settlement on window reload", async () => {
    const pending = Promise.withResolvers<Browser.Result>();
    let signal: AbortSignal | undefined;
    native.execute.mockImplementation((_command, abort) => {
      signal = abort;
      return pending.promise;
    });
    const lifetime = start();
    await vi.waitFor(() => expect(events[0]).toMatchObject({ status: "connected" }));
    const command = runtime.runPromiseExit(
      host.command(window, input.bindingID, { type: "tabs.open" }),
    );
    await vi.waitFor(() => expect(native.execute).toHaveBeenCalledOnce());
    window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(native.dispose).not.toHaveBeenCalled();
    pending.resolve({ value: emptyBrowserState(), files: [] });
    await Promise.all([lifetime, command]);
    expect(native.dispose).toHaveBeenCalledOnce();
  });

  it("reports replacement only after cleanup and does not reconnect", async () => {
    const lifetime = start();
    await vi.waitFor(() => expect(events[0]).toMatchObject({ status: "connected" }));
    await Effect.runPromise(Deferred.succeed(closed, "replaced"));
    await lifetime;
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ status: "replaced" });
  });
});
