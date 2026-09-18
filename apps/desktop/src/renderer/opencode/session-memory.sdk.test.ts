import {
  OpenCode,
  type SessionDeleted,
  type SessionInfo,
  type SessionMessageIdle,
} from "@opencode/client";
import { createData } from "@opencode/client/solid";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../test/deferred.ts";
import { sessionFixture } from "../test/session-fixture.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { createOpenCodeEventSource } from "./event-source.ts";
import { createSessionMemory } from "./session-memory.ts";
import { createSessionReads } from "./session-reads.ts";

const session = (id: string, parentID?: string): SessionInfo =>
  sessionFixture({ id, parentID, title: id, location: { directory: "/workspace" } });

const idle = (id: string): SessionMessageIdle => ({
  id,
  time: { created: 0 },
  type: "idle",
  outcome: "succeeded",
});

function setup(options: { next?: string } = {}) {
  const events = createOpenCodeEventSource();
  const rows = new Map<string, SessionMessageIdle[]>();
  const pending = new Map<string, Promise<unknown>>();
  const client = OpenCode.make({ baseUrl: "http://memory.test" });
  vi.spyOn(client.message, "list").mockImplementation(async ({ sessionID }) => {
    const waiting = pending.get(sessionID);
    if (waiting) await waiting;
    return { data: rows.get(sessionID) ?? [], cursor: { next: options.next } };
  });

  return withTestWorkspace((effects) => {
    const data = createData({
      api: () => client,
      directory: "/workspace",
      event: events,
      connection: { status: () => "connected" },
    });
    const reads = createSessionReads();
    const ids = new Set<string>();
    const memory = createSessionMemory({
      effects,
      data,
      sessions: { ids: () => [...ids] },
      reads,
      budget: 1,
    });
    const remember = (info: SessionInfo): void => {
      ids.add(info.id);
      data.session.remember(info);
    };
    const remove = (sessionID: string): void => {
      ids.delete(sessionID);
      const deleted: SessionDeleted = {
        id: `event_${sessionID}`,
        created: 0,
        type: "session.deleted",
        durable: { aggregateID: sessionID, seq: 1, version: 2 },
        data: { sessionID },
      };
      events.emit(deleted);
    };
    return { effects, data, memory, reads, rows, pending, remember, remove };
  });
}

describe("session memory against the SDK", () => {
  it("clears an inactive family and rehydrates it with a restored cursor", async () => {
    const fixture = setup({ next: "older" });
    fixture.rows.set("s1", [idle("m1")]);
    fixture.rows.set("s2", [idle("m2")]);
    fixture.remember(session("s1"));
    fixture.remember(session("s2"));
    await fixture.data.session.message.sync("s1");
    fixture.memory.touchSelection("s1");
    expect(fixture.data.session.message.list("s1")).toHaveLength(1);

    await fixture.data.session.message.sync("s2");
    fixture.memory.touchSelection("s2");

    expect(fixture.data.session.message.list("s1")).toHaveLength(0);
    expect(fixture.data.session.message.list("s2")).toHaveLength(1);
    expect(fixture.data.session.message.more("s1")).toBe(false);

    await fixture.data.session.message.sync("s1");

    expect(fixture.data.session.message.list("s1")).toHaveLength(1);
    expect(fixture.data.session.message.more("s1")).toBe(true);
  });

  it("resolves descendants into the selected family and keeps them resident", async () => {
    const fixture = setup();
    fixture.rows.set("root", [idle("m_root")]);
    fixture.rows.set("child", [idle("m_child")]);
    fixture.remember(session("root"));
    fixture.remember(session("child", "root"));
    await fixture.data.session.message.sync("root");
    await fixture.data.session.message.sync("child");

    fixture.memory.touchSelection("child");

    expect(fixture.data.session.message.list("root")).toHaveLength(1);
    expect(fixture.data.session.message.list("child")).toHaveLength(1);
  });

  it("reconciles a family that republishes after deletion and read settlement", async () => {
    const fixture = setup();
    fixture.rows.set("gone", [idle("m_gone")]);
    fixture.remember(session("gone"));
    fixture.remember(session("kept"));

    // Hold the initial read so deletion lands before its publication.
    const gate = deferred();
    fixture.pending.set("gone", gate.promise);
    const read = fixture.effects.runPromise(
      fixture.reads.track(
        "gone",
        Effect.promise(() => fixture.data.session.message.sync("gone")),
      ),
    );
    fixture.memory.touchSelection("gone");
    fixture.memory.touchSelection("kept");

    fixture.remove("gone");
    gate.resolve();
    await read;

    expect(fixture.data.session.message.list("gone")).toHaveLength(0);
    expect(fixture.data.session.message.more("gone")).toBe(false);
    expect(fixture.data.session.get("kept")?.id).toBe("kept");
  });
});
