import { describe, expect, it, vi } from "vite-plus/test";
import { ownTerminalPage, withTerminalFixture } from "./e2e/terminal-fixture.mjs";
import { EventEmitter } from "node:events";

function server() {
  const ptys = new Map([["baseline", { id: "baseline" }]]);
  const sessions = new Map();
  const api = {
    pty: {
      list: vi.fn(async () => ({ data: [...ptys.values()] })),
      get: vi.fn(async ({ ptyID }) => ({ data: ptys.get(ptyID) })),
      remove: vi.fn(async ({ ptyID }) => {
        ptys.delete(ptyID);
      }),
    },
    session: {
      create: vi.fn(async (input) => {
        sessions.set(input.id, input);
        return input;
      }),
      remove: vi.fn(async ({ sessionID }) => {
        sessions.delete(sessionID);
      }),
      get: vi.fn(async ({ sessionID }) => {
        if (!sessions.has(sessionID)) throw { _tag: "SessionNotFoundError", sessionID };
        return sessions.get(sessionID);
      }),
    },
  };
  return { api, ptys, sessions };
}

describe("terminal browser fixture ownership", () => {
  it.each(["pending", "lost", "settled"])(
    "disposes the renderer and classifies %s PTY creation settlement",
    async (state) => {
      const fake = server();
      const page = new EventEmitter();
      page.close = vi.fn(async () => {});
      const creating = { method: () => "POST", url: () => "https://fixture/api/pty" };
      const outcome = withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
        ownTerminalPage(fixture, page);
        page.emit("request", creating);
        if (state === "settled") page.emit("requestfinished", creating);
        if (state === "lost") page.emit("requestfailed", creating);
      });
      if (state === "settled") await outcome;
      else await expect(outcome).rejects.toMatchObject({ cleanupFailed: true });
      expect(page.close).toHaveBeenCalledOnce();
      expect(page.eventNames()).toEqual([]);
      expect([...fake.ptys.keys()]).toEqual(["baseline"]);
    },
  );
  it("runs cleanup registered during awaited fault restoration", async () => {
    const fake = server();
    const closed = vi.fn();
    await withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
      fixture.restore(async () => {
        await Promise.resolve();
        fixture.cleanup(closed);
      });
    });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("detects creation that starts while the renderer is closing", async () => {
    const fake = server();
    const page = new EventEmitter();
    const creating = { method: () => "POST", url: () => "https://fixture/api/pty" };
    page.close = vi.fn(async () => {
      page.emit("request", creating);
      page.emit("requestfailed", creating);
    });
    await expect(
      withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
        ownTerminalPage(fixture, page);
      }),
    ).rejects.toMatchObject({ cleanupFailed: true });
    expect(page.eventNames()).toEqual([]);
  });

  it("detaches listeners and continues remote cleanup when renderer disposal fails", async () => {
    const fake = server();
    const page = new EventEmitter();
    const failure = new Error("Renderer disposal failed");
    page.close = vi.fn(async () => {
      throw failure;
    });
    await expect(
      withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
        ownTerminalPage(fixture, page);
        await fixture.createSession({ title: "owned" });
        fake.ptys.set("owned", { id: "owned" });
      }),
    ).rejects.toMatchObject({ cleanupFailed: true, errors: [failure] });
    expect(page.eventNames()).toEqual([]);
    expect([...fake.ptys.keys()]).toEqual(["baseline"]);
    expect(fake.sessions.size).toBe(0);
  });

  it("reports unresolved isolation when failed creation can still apply later", async () => {
    const fake = server();
    let delayed;
    fake.api.session.create.mockImplementationOnce(async (input) => {
      delayed = input;
      throw new Error("Response lost before authoritative settlement");
    });
    await expect(
      withTerminalFixture(fake.api, { directory: "/fixture" }, (fixture) =>
        fixture.createSession({ title: "pending" }),
      ),
    ).rejects.toMatchObject({ cleanupFailed: true });
    fake.sessions.set(delayed.id, delayed);
    expect(fake.sessions.size).toBe(1);
  });
  it("reconciles a PTY after failure before creation returns and preserves baseline processes", async () => {
    const fake = server();
    const faults = new Set();
    await expect(
      withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
        await fixture.createSession({ title: "owned" });
        faults.add("held-font");
        fixture.cleanup(() => faults.clear());
        fixture.checkpoint("font readiness");
        // The server applied creation; the UI never supplied a terminal record.
        fake.ptys.set("unacknowledged", { id: "unacknowledged" });
        throw new Error("Renderer failed before returning its terminal");
      }),
    ).rejects.toMatchObject({
      cleanupFailed: false,
      message: expect.stringContaining("font readiness"),
    });
    expect([...fake.ptys.keys()]).toEqual(["baseline"]);
    expect(fake.sessions.size).toBe(0);
    expect(faults.size).toBe(0);
    // A subsequent scenario has a usable, isolated location.
    await withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
      expect((await fixture.list()).map((pty) => pty.id)).toEqual(["baseline"]);
      fake.ptys.set("next", { id: "next" });
    });
    expect([...fake.ptys.keys()]).toEqual(["baseline"]);
    for (const [, options] of fake.api.pty.list.mock.calls)
      expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the original failure and attempts every cleanup when another cleanup fails", async () => {
    const fake = server();
    const closed = vi.fn();
    const original = new Error("scenario failed");
    const cleanup = new Error("route cleanup failed");
    const result = withTerminalFixture(fake.api, { directory: "/fixture" }, async (fixture) => {
      await fixture.createSession({ title: "owned" });
      fixture.cleanup(closed);
      fixture.cleanup(() => {
        throw cleanup;
      });
      fake.ptys.set("owned", { id: "owned" });
      throw original;
    });
    await expect(result).rejects.toMatchObject({
      cleanupFailed: true,
      errors: [expect.objectContaining({ cause: original }), cleanup],
    });
    expect(closed).toHaveBeenCalledOnce();
    expect([...fake.ptys.keys()]).toEqual(["baseline"]);
    expect(fake.sessions.size).toBe(0);
  });

  it("removes a session whose creation applied before its response was lost", async () => {
    const fake = server();
    fake.api.session.create.mockImplementationOnce(async (input) => {
      fake.sessions.set(input.id, input);
      throw new Error("Creation response lost");
    });
    await expect(
      withTerminalFixture(fake.api, { directory: "/fixture" }, (fixture) =>
        fixture.createSession({ title: "owned" }),
      ),
    ).rejects.toThrow("Terminal fixture failed");
    expect(fake.sessions.size).toBe(0);
    expect(fake.api.session.create).toHaveBeenCalledOnce();
    expect(fake.api.session.remove).toHaveBeenCalledOnce();
  });
});
