import { OpenCode, type LocationRef, type Pty } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { withTestWorkspace } from "../test/workspace.ts";
import { createTerminalSessions } from "./terminal-sessions.ts";

const location: LocationRef = { directory: "/server/project", workspaceID: "ws_1" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = <A>() => {
  let resolve!: (value: A) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

class Socket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly bufferedAmount = 0;
  readonly extensions = "";
  readonly protocol = "";
  readonly url = "wss://server.test";
  onopen = null;
  onclose = null;
  onerror = null;
  onmessage = null;
  readyState: WebSocket["readyState"] = 0;
  binaryType: BinaryType = "blob";
  readonly send = vi.fn<WebSocket["send"]>();
  readonly close = vi.fn<WebSocket["close"]>(() => {
    this.readyState = 3;
  });
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  output(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  metadata(cursor: number) {
    const json = new TextEncoder().encode(JSON.stringify({ cursor }));
    const frame = new Uint8Array(json.length + 1);
    frame.set(json, 1);
    this.dispatchEvent(new MessageEvent("message", { data: frame.buffer }));
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
}

function setup() {
  const info: Pty = {
    id: "pty_1",
    title: "shell",
    cwd: location.directory,
    status: "running",
    command: "/bin/sh",
    args: [],
    pid: 10,
  };
  const response = {
    data: info,
    location: {
      directory: location.directory,
      workspaceID: location.workspaceID,
      project: { id: "project_1", directory: location.directory, canonical: location.directory },
    },
  };
  const api = OpenCode.make({ baseUrl: "https://server.test" });
  const create = vi.spyOn(api.pty, "create").mockImplementation(async () => response);
  const list = vi.spyOn(api.pty, "list").mockImplementation(async () => ({
    ...response,
    data: [info],
  }));
  const get = vi.spyOn(api.pty, "get").mockImplementation(async () => response);
  const update = vi.spyOn(api.pty, "update").mockImplementation(async () => response);
  const remove = vi.spyOn(api.pty, "remove").mockImplementation(async () => undefined);
  const token = vi.spyOn(api.pty.connect, "token").mockImplementation(async () => ({
    data: { ticket: "authorized-ticket", expires_in: 60 },
    location: response.location,
  }));
  const sockets: Socket[] = [];
  const urls: URL[] = [];
  return withTestWorkspace((effects) => {
    const terminals = createTerminalSessions({
      effects,
      api,
      serverUrl: "https://server.test/base",
      openSocket: (url) => {
        urls.push(url);
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
    });
    const attach = () => {
      const transport = terminals.transport("pty_1");
      const callbacks = {
        onData: vi.fn<(data: string) => void>(),
        onConnect: vi.fn<() => void>(),
        onDisconnect: vi.fn<() => void>(),
        onError: vi.fn<(message: string) => void>(),
        onExit: vi.fn<(code: number) => void>(),
      };
      void transport.connect({ url: "ignored", cols: 80, rows: 24, callbacks });
      return { transport, callbacks };
    };
    return {
      terminals,
      effects,
      info,
      response,
      create,
      list,
      get,
      update,
      remove,
      token,
      sockets,
      urls,
      attach,
    };
  });
}

describe("workspace terminal sessions", () => {
  it("discovers shells across locations while cancelling obsolete discovery", async () => {
    const s = setup();
    const old = deferred<Awaited<ReturnType<typeof s.list>>>();
    s.list.mockImplementationOnce(() => old.promise);
    s.terminals.sync(location);
    const other = { directory: "/server/other", workspaceID: "ws_2" };
    const otherInfo = {
      ...s.info,
      id: "pty_2",
      title: "\u001bother shell\n",
      cwd: other.directory,
    };
    s.list.mockResolvedValueOnce({ ...s.response, data: [otherInfo] });
    s.terminals.sync(other);
    const signal = s.list.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
    await settle();
    old.resolve({ ...s.response, data: [s.info] });
    await settle();
    expect(s.terminals.entries()).toHaveLength(1);
    expect(s.terminals.entries()[0]).toMatchObject({
      id: "pty_2",
      location: other,
      title: "other shell",
    });
    expect(s.terminals.activeID(other)).toBe("pty_2");
    s.terminals.sync(location);
    await settle();
    expect(s.terminals.entries()).toHaveLength(2);
    expect(s.terminals.activeID(location)).toBe("pty_1");
    s.info.status = "exited";
    s.terminals.sync(location);
    await settle();
    expect(s.terminals.entries().find((entry) => entry.id === "pty_1")?.status).toBe("exited");
    expect(s.terminals.entries().find((entry) => entry.id === "pty_2")?.location).toEqual(other);
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("serializes reconnect behind a pending ticket and preserves failure during synchronous transport disconnect", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const ticket = deferred<Awaited<ReturnType<typeof s.token>>>();
    s.token.mockImplementationOnce(() => ticket.promise);
    const { transport, callbacks } = s.attach();
    s.terminals.reconnect("pty_1");
    expect(s.token).toHaveBeenCalledOnce();
    ticket.resolve({ data: { ticket: "late", expires_in: 60 }, location: s.response.location });
    await settle();
    expect(s.token).toHaveBeenCalledTimes(2);
    expect(s.sockets[0]!.close).toHaveBeenCalled();
    callbacks.onError.mockImplementation(() => transport.disconnect());
    vi.useFakeTimers();
    try {
      s.sockets[1]!.drop();
      s.sockets[1]!.output("stale output after closure");
      expect(callbacks.onData).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      s.sockets[2]!.drop();
      await vi.advanceTimersByTimeAsync(500);
      s.sockets[3]!.drop();
      await vi.advanceTimersByTimeAsync(1000);
      s.sockets[4]!.drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(callbacks.onError).toHaveBeenCalledOnce();
      expect(s.terminals.entries()[0]?.status).toBe("failed");
      s.terminals.reconnect("pty_1");
      await vi.advanceTimersByTimeAsync(0);
      s.sockets[5]!.open();
      s.sockets[5]!.metadata(0);
      s.sockets[5]!.output("recovered");
      expect(callbacks.onData).toHaveBeenCalledWith("recovered");
      expect(transport.isConnected()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the remount replay cache and treats 4404 as a terminal exit", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const first = s.attach();
    await settle();
    s.sockets[0]!.open();
    const output = `start${"x".repeat(2 * 1024 * 1024)}`;
    s.sockets[0]!.output(output);
    s.sockets[0]!.metadata(output.length);
    await first.transport.destroy?.();
    const second = s.attach();
    await settle();
    expect(second.callbacks.onData.mock.calls[0]?.[0]).toBe("x".repeat(2 * 1024 * 1024));
    expect(s.urls[1]?.searchParams.get("cursor")).toBe(String(output.length));
    s.sockets[1]!.drop(4404);
    await settle();
    expect(second.callbacks.onExit).toHaveBeenCalledOnce();
    expect(s.terminals.entries()[0]?.status).toBe("exited");
    expect(s.get).not.toHaveBeenCalled();
  });

  it("preserves server location and uses the upstream authenticated ticket helper", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    expect(s.terminals.activeID(location)).toBe("pty_1");
    expect(s.terminals.activeID({ ...location, workspaceID: "other" })).toBeUndefined();
    expect(s.create.mock.calls[0]?.[0]).toMatchObject({
      cwd: location.directory,
      location: { directory: location.directory, workspace: "ws_1" },
    });
    const { transport, callbacks } = s.attach();
    await settle();
    expect(s.token.mock.calls[0]?.[0]).toEqual({
      ptyID: "pty_1",
      location: { directory: location.directory, workspace: "ws_1" },
      "x-opencode-ticket": "1",
    });
    expect(s.urls[0]?.protocol).toBe("wss:");
    expect(s.urls[0]?.searchParams.get("ticket")).toBe("authorized-ticket");
    expect(s.urls[0]?.searchParams.get("location[workspace]")).toBe("ws_1");
    expect(s.sockets[0]?.binaryType).toBe("arraybuffer");
    expect(transport.sendInput("early")).toBe(false);
    s.sockets[0]!.open();
    expect(callbacks.onConnect).toHaveBeenCalledOnce();
    expect(transport.sendInput("echo hello\r")).toBe(true);
    expect(s.sockets[0]!.send).toHaveBeenCalledWith("echo hello\r");
    expect(s.update.mock.calls[0]?.[0]).toMatchObject({ size: { cols: 80, rows: 24 } });
  });

  it("retains late ticket acquisition through detach and closes its late socket", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const ticket = deferred<Awaited<ReturnType<typeof s.token>>>();
    s.token.mockImplementationOnce(() => ticket.promise);
    const { transport, callbacks } = s.attach();
    await transport.destroy?.();
    ticket.resolve({ data: { ticket: "late", expires_in: 60 }, location: s.response.location });
    await settle();
    expect(s.sockets[0]!.close).toHaveBeenCalled();
    s.sockets[0]!.open();
    expect(callbacks.onConnect).not.toHaveBeenCalled();
    expect(s.terminals.entries()[0]?.status).toBe("idle");
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("closing wins over a pending connection and retains failed removal for retry", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const ticket = deferred<Awaited<ReturnType<typeof s.token>>>();
    s.token.mockImplementationOnce(() => ticket.promise);
    const { callbacks } = s.attach();
    s.remove.mockRejectedValueOnce(new Error("network"));
    s.terminals.close("pty_1");
    ticket.resolve({ data: { ticket: "late", expires_in: 60 }, location: s.response.location });
    await settle();
    expect(s.sockets[0]!.close).toHaveBeenCalled();
    expect(callbacks.onConnect).not.toHaveBeenCalled();
    expect(s.terminals.entries()[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("closed"),
    });
    s.terminals.close("pty_1");
    await settle();
    expect(s.remove).toHaveBeenCalledTimes(2);
    expect(s.terminals.entries()).toEqual([]);
    expect(s.terminals.activeID(location)).toBeUndefined();
  });

  it("coalesces resize behind the unsettled update and serializes removal", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const first = deferred<typeof s.response>();
    s.update.mockImplementationOnce(() => first.promise);
    const { transport } = s.attach();
    await settle();
    expect(transport.resize(0, 10)).toBe(false);
    expect(transport.resize(NaN, 10)).toBe(false);
    transport.resize(90, 30);
    transport.resize(120, 40);
    expect(s.update).toHaveBeenCalledOnce();
    first.resolve(s.response);
    await settle();
    expect(s.update).toHaveBeenCalledTimes(2);
    expect(s.update.mock.calls[1]?.[0]).toMatchObject({ size: { cols: 120, rows: 40 } });
    const second = deferred<typeof s.response>();
    s.update.mockImplementationOnce(() => second.promise);
    transport.resize(140, 50);
    s.terminals.close("pty_1");
    expect(s.remove).not.toHaveBeenCalled();
    second.resolve(s.response);
    await settle();
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.terminals.entries()).toEqual([]);
  });

  it("clears a resize failure once a later connected resize succeeds", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const { transport } = s.attach();
    await settle();
    s.sockets[0]!.open();
    await settle();
    s.update.mockRejectedValueOnce(new Error("Resize response lost"));
    transport.resize(90, 30);
    await settle();
    expect(s.terminals.entries()[0]?.error).toContain("size");
    transport.resize(91, 31);
    await settle();
    expect(s.terminals.entries()[0]?.status).toBe("connected");
    expect(s.terminals.entries()[0]?.error).toBeUndefined();
  });

  it("drains the latest desired size after an older in-flight resize fails", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const { transport } = s.attach();
    await settle();
    s.sockets[0]!.open();
    const older = deferred<typeof s.response>();
    const latest = deferred<typeof s.response>();
    s.update.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    transport.resize(90, 30);
    transport.resize(120, 40);
    older.reject(new Error("Resize response lost"));
    await settle();
    expect(s.update.mock.calls.at(-1)?.[0]).toMatchObject({ size: { cols: 120, rows: 40 } });
    expect(s.terminals.entries()[0]?.error).toContain("size");
    latest.resolve(s.response);
    await settle();
    expect(s.terminals.entries()[0]?.error).toBeUndefined();
  });

  it("resets recovery after healthy replay-ready connections but bounds rapid open/close flapping", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    s.attach();
    await settle();
    vi.useFakeTimers();
    try {
      for (let cycle = 0; cycle < 6; cycle += 1) {
        s.sockets[cycle]!.open();
        s.sockets[cycle]!.metadata(cycle);
        await vi.advanceTimersByTimeAsync(5_000);
        s.sockets[cycle]!.drop();
        await vi.advanceTimersByTimeAsync(250);
        expect(s.sockets).toHaveLength(cycle + 2);
      }
      for (const [index, delay] of [
        [6, 500],
        [7, 1000],
        [8, 0],
      ] as const) {
        s.sockets[index]!.open();
        s.sockets[index]!.metadata(index);
        s.sockets[index]!.drop();
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(s.terminals.entries()[0]?.status).toBe("failed");
      expect(s.sockets).toHaveLength(9);
      expect(s.create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits replay at absolute metadata and advances live cursors by UTF-16 units", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const { callbacks } = s.attach();
    await settle();
    s.sockets[0]!.open();
    s.sockets[0]!.output("😀");
    expect(callbacks.onData).not.toHaveBeenCalled();
    s.sockets[0]!.metadata(900);
    s.sockets[0]!.output("😀!");
    expect(callbacks.onData.mock.calls.map(([data]) => data)).toEqual(["😀", "😀!"]);
    s.terminals.reconnect("pty_1");
    await settle();
    expect(s.urls[1]?.searchParams.get("cursor")).toBe("903");
    expect(s.token).toHaveBeenCalledTimes(2);
    expect(s.create).toHaveBeenCalledOnce();
    s.sockets[0]!.output("stale");
    expect(callbacks.onData).toHaveBeenCalledTimes(2);
  });

  it("does not render an incomplete replay twice and restores committed output on remount", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const first = s.attach();
    await settle();
    s.sockets[0]!.open();
    s.sockets[0]!.output("unfinished");
    s.terminals.reconnect("pty_1");
    await settle();
    s.sockets[1]!.open();
    s.sockets[1]!.output("unfinished");
    s.sockets[1]!.metadata(10);
    expect(first.callbacks.onData.mock.calls).toEqual([["unfinished"]]);
    await first.transport.destroy?.();
    const second = s.attach();
    await settle();
    expect(second.callbacks.onData.mock.calls).toEqual([["unfinished"]]);
    expect(s.urls[2]?.searchParams.get("cursor")).toBe("10");
    first.transport.disconnect();
    s.sockets[2]!.open();
    expect(second.transport.isConnected()).toBe(true);
  });

  it("reconciles an applied create after a missing response without duplicating the shell", async () => {
    const s = setup();
    s.create.mockImplementationOnce(async (input) => {
      s.info.title = input!.title!;
      throw new Error("response lost");
    });
    s.list.mockRejectedValueOnce(new Error("offline"));
    s.terminals.create(location);
    await settle();
    expect(s.terminals.error()).toContain("could not be confirmed");
    expect(s.terminals.creating()).toBe(false);
    s.terminals.create(location);
    await settle();
    expect(s.create).toHaveBeenCalledOnce();
    expect(s.list).toHaveBeenCalledTimes(2);
    expect(s.terminals.entries()[0]?.id).toBe("pty_1");
    expect(s.terminals.error()).toBeUndefined();
  });

  it("does not repeat an uncertain create when reconciliation finds no shell", async () => {
    const s = setup();
    s.create.mockRejectedValueOnce(new Error("response lost"));
    s.list.mockResolvedValue({ ...s.response, data: [] });
    s.terminals.create(location);
    await settle();
    s.terminals.create(location);
    await settle();
    expect(s.create).toHaveBeenCalledOnce();
    expect(s.terminals.entries()).toEqual([]);
    expect(s.terminals.error()).toContain("could not be confirmed");
  });

  it("recognizes exited sockets and checks server state on a clean close", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const { callbacks, transport } = s.attach();
    await settle();
    s.sockets[0]!.open();
    s.info.status = "exited";
    s.sockets[0]!.drop(1000);
    await settle();
    expect(s.get).toHaveBeenCalledOnce();
    expect(s.terminals.entries()[0]?.status).toBe("exited");
    expect(callbacks.onExit).toHaveBeenCalledWith(0);
    expect(transport.sendInput("no")).toBe(false);
    s.terminals.reconnect("pty_1");
    expect(s.token).toHaveBeenCalledOnce();
  });

  it("automatically reconnects a dropped socket with a fresh ticket for the same PTY", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    s.attach();
    await settle();
    s.sockets[0]!.open();
    s.sockets[0]!.metadata(30);
    vi.useFakeTimers();
    try {
      s.sockets[0]!.drop();
      await vi.advanceTimersByTimeAsync(250);
      expect(s.token).toHaveBeenCalledTimes(2);
      expect(s.urls[1]?.searchParams.get("cursor")).toBe("30");
      s.sockets[1]!.drop();
      await vi.advanceTimersByTimeAsync(500);
      s.sockets[2]!.drop();
      await vi.advanceTimersByTimeAsync(1000);
      s.sockets[3]!.drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.terminals.entries()[0]?.status).toBe("failed");
      expect(s.token).toHaveBeenCalledTimes(4);
      expect(s.create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows creation after a definitive rejection is corrected", async () => {
    const s = setup();
    s.create.mockRejectedValueOnce({ _tag: "UnauthorizedError" });
    s.terminals.create(location);
    await settle();
    expect(s.terminals.error()).toContain("rejected");
    s.terminals.create(location);
    await settle();
    expect(s.create).toHaveBeenCalledTimes(2);
    expect(s.terminals.entries()).toHaveLength(1);
  });

  it("settles a close whose successful server response was lost", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    s.remove.mockRejectedValueOnce(new Error("Response lost"));
    s.terminals.close("pty_1");
    await settle();
    expect(s.terminals.entries()).toHaveLength(1);
    s.remove.mockRejectedValueOnce({ _tag: "PtyNotFoundError" });
    s.terminals.close("pty_1");
    await settle();
    expect(s.terminals.entries()).toHaveLength(0);
  });

  it("does not resurrect closed terminals from stale discovery responses", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const discovery = deferred<Awaited<ReturnType<typeof s.list>>>();
    s.list.mockReturnValueOnce(discovery.promise);
    s.terminals.sync(location);
    s.terminals.close("pty_1");
    await settle();
    discovery.resolve({ ...s.response, data: [s.info] });
    await settle();
    expect(s.terminals.entries()).toHaveLength(0);
  });

  it("waits for detached late ticket cleanup before reconnecting", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const ticket = deferred<Awaited<ReturnType<typeof s.token>>>();
    s.token.mockReturnValueOnce(ticket.promise);
    const { transport } = s.attach();
    await settle();
    transport.disconnect();
    expect(s.token.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    s.terminals.reconnect("pty_1");
    await settle();
    expect(s.token).toHaveBeenCalledOnce();
    ticket.resolve({ data: { ticket: "late", expires_in: 60 }, location: s.response.location });
    await settle();
    expect(s.sockets[0]?.close).toHaveBeenCalled();
    expect(s.token).toHaveBeenCalledTimes(2);
  });

  it("disposal waits for a non-abortable late ticket and closes attachments without removing shells", async () => {
    const s = setup();
    s.terminals.create(location);
    await settle();
    const ticket = deferred<Awaited<ReturnType<typeof s.token>>>();
    s.token.mockImplementationOnce(() => ticket.promise);
    const { callbacks } = s.attach();
    let closed = false;
    const closing = Effect.runPromise(Scope.close(s.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await settle();
    expect(closed).toBe(false);
    ticket.resolve({ data: { ticket: "late", expires_in: 60 }, location: s.response.location });
    await closing;
    expect(s.sockets[0]!.close).toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    s.sockets[0]!.open();
    expect(callbacks.onConnect).not.toHaveBeenCalled();
  });
});
