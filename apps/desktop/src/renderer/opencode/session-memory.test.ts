import type {
  OpenCodeEvent,
  SessionInboxUser,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionInboxInfo,
} from "@opencode/client";
import type { DataSessionStatus } from "@opencode/client/solid";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { deferred } from "../test/deferred.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { createSessionMemory } from "./session-memory.ts";
import { createSessionReads } from "./session-reads.ts";

type MemoryData = Parameters<typeof createSessionMemory>[0]["data"];
type DeletedEvent = Extract<OpenCodeEvent, { type: "session.deleted" }>;

const idle = (sessionID: string): SessionMessageIdle => ({
  id: `msg_${sessionID}`,
  time: { created: 0 },
  type: "idle",
  outcome: "succeeded",
});
const inbox = (sessionID: string): SessionInboxUser => ({
  id: `inbox_${sessionID}`,
  sessionID,
  timeCreated: 0,
  type: "user",
  delivery: "queue",
  payload: { text: "pending" },
});

function createFakeData() {
  const infos = new Map<string, { parentID?: string }>();
  const catalog = new Set<string>();
  const messages = new Map<string, SessionMessageInfo[]>();
  const pending = new Map<string, SessionInboxInfo[]>();
  const loading = new Set<string>();
  const creating = new Set<string>();
  const statuses = new Map<string, DataSessionStatus>();
  const evicted: string[] = [];
  const deletedHandlers = new Set<(event: DeletedEvent) => void>();

  const root = (sessionID: string): string => {
    let current = sessionID;
    let parent = infos.get(sessionID)?.parentID;
    const seen = new Set([sessionID]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      current = parent;
      parent = infos.get(parent)?.parentID;
    }
    return current;
  };
  const family = (sessionID: string): string[] => {
    const target = root(sessionID);
    return [...infos.keys()].filter((candidate) => root(candidate) === target);
  };

  const data = {
    on: (_type: "session.deleted", handler: (event: DeletedEvent) => void) => {
      deletedHandlers.add(handler);
      return () => deletedHandlers.delete(handler);
    },
    session: {
      root,
      family,
      evict: (sessionID: string): void => {
        const cleared = new Set([root(sessionID), sessionID, ...family(sessionID)]);
        for (const member of cleared) {
          messages.delete(member);
          pending.delete(member);
        }
        evicted.push(root(sessionID));
      },
      creating: (sessionID: string): boolean => creating.has(sessionID),
      status: (sessionID: string): DataSessionStatus => statuses.get(sessionID) ?? "idle",
      message: {
        list: (sessionID: string): SessionMessageInfo[] => messages.get(sessionID) ?? [],
        loading: (sessionID: string): boolean => loading.has(sessionID),
      },
      pending: {
        list: (sessionID: string): SessionInboxInfo[] => pending.get(sessionID) ?? [],
      },
    },
  } satisfies MemoryData;

  return {
    data,
    root,
    family,
    evicted,
    knownIDs: (): string[] => [...catalog],
    remember: (sessionID: string, parentID?: string): void => {
      infos.set(sessionID, { parentID });
      catalog.add(sessionID);
    },
    hideFromCatalog: (sessionID: string): void => {
      catalog.delete(sessionID);
    },
    load: (sessionID: string): void => {
      messages.set(sessionID, [idle(sessionID)]);
    },
    clearMessages: (sessionID: string): void => {
      messages.set(sessionID, []);
    },
    setPending: (sessionID: string): void => {
      pending.set(sessionID, [inbox(sessionID)]);
    },
    setLoading: (sessionID: string, value: boolean) =>
      value ? loading.add(sessionID) : loading.delete(sessionID),
    setCreating: (sessionID: string, value: boolean) =>
      value ? creating.add(sessionID) : creating.delete(sessionID),
    setStatus: (sessionID: string, status: DataSessionStatus) => statuses.set(sessionID, status),
    emitDeleted: (sessionID: string) => {
      const event: DeletedEvent = {
        id: `event_${sessionID}`,
        created: 0,
        type: "session.deleted",
        durable: { aggregateID: sessionID, seq: 1, version: 2 },
        data: { sessionID },
      };
      for (const handler of deletedHandlers) handler(event);
    },
  };
}

function setup(budget?: number) {
  const fake = createFakeData();
  return withTestWorkspace((effects) => {
    const reads = createSessionReads();
    const memory = createSessionMemory({
      effects,
      data: fake.data,
      sessions: { ids: () => fake.knownIDs() },
      reads,
      budget,
    });
    return {
      effects,
      reads,
      memory,
      data: fake.data,
      evicted: fake.evicted,
      remember: fake.remember,
      hideFromCatalog: fake.hideFromCatalog,
      load: fake.load,
      clearMessages: fake.clearMessages,
      setPending: fake.setPending,
      setLoading: fake.setLoading,
      setCreating: fake.setCreating,
      setStatus: fake.setStatus,
      emitDeleted: fake.emitDeleted,
    };
  });
}

describe("createSessionMemory", () => {
  it("evicts least-recent resident families beyond the target", () => {
    const fixture = setup(1);
    for (const id of ["a", "b", "c", "d"]) fixture.remember(id);

    fixture.load("a");
    fixture.memory.touchSelection("a");
    expect(fixture.evicted).toEqual([]);

    fixture.load("b");
    fixture.memory.touchSelection("b");
    expect(fixture.evicted).toEqual(["a"]);

    fixture.load("c");
    fixture.memory.touchSelection("c");
    expect(fixture.evicted).toEqual(["a", "b"]);

    fixture.load("d");
    fixture.memory.touchSelection("d");
    expect(fixture.evicted).toEqual(["a", "b", "c"]);
  });

  it("keeps five resident families by default", () => {
    const fixture = setup();
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      fixture.remember(id);
      fixture.load(id);
      fixture.memory.touchSelection(id);
    }

    expect(fixture.evicted).toEqual(["a"]);
    expect(fixture.data.session.message.list("f").length).toBeGreaterThan(0);
  });

  it("keeps the selected family even when it was visited first", () => {
    const fixture = setup(1);
    fixture.remember("a");
    fixture.remember("b");

    fixture.load("a");
    fixture.memory.touchSelection("a");
    fixture.load("b");
    fixture.memory.touchSelection("b");
    expect(fixture.evicted).toEqual(["a"]);
    fixture.memory.touchSelection("a");
    expect(fixture.evicted).toEqual(["a", "b"]);
  });

  it("refuses a family with an active application read, then retrims on settle", async () => {
    const fixture = setup(1);
    fixture.remember("a");
    fixture.remember("b");

    const gate = deferred();
    const read = fixture.effects.runPromise(
      fixture.reads.track(
        "a",
        Effect.promise(() => gate.promise),
      ),
    );
    fixture.memory.touchSelection("a");
    fixture.memory.touchSelection("b");
    expect(fixture.evicted).toEqual([]);

    fixture.load("a");
    gate.resolve();
    await read;
    expect(fixture.evicted).toEqual(["a"]);
  });

  it("preserves a loading family's recency until its read settles", async () => {
    const fixture = setup(2);
    fixture.remember("a");
    fixture.remember("b");
    fixture.remember("c");
    fixture.load("b");
    fixture.clearMessages("a");

    const gate = deferred();
    const read = fixture.effects.runPromise(
      fixture.reads.track(
        "a",
        Effect.promise(() => gate.promise),
      ),
    );
    fixture.memory.touchSelection("a");
    fixture.memory.touchSelection("b");
    expect(fixture.evicted).toEqual([]);

    fixture.load("a");
    gate.resolve();
    await read;
    fixture.load("c");
    fixture.memory.touchSelection("c");
    expect(fixture.evicted).toEqual(["a"]);
  });

  it("refuses families with pending items, pending sends, or a running session", () => {
    const fixture = setup(1);
    for (const id of ["pending", "creating", "running", "idle"]) {
      fixture.remember(id);
      fixture.load(id);
    }
    fixture.setPending("pending");
    fixture.setCreating("creating", true);
    fixture.setStatus("running", "running");

    fixture.memory.touchSelection("idle");

    expect(fixture.evicted).toEqual([]);
  });

  it("refuses a family with an active SDK pagination read", () => {
    const fixture = setup(1);
    fixture.remember("a");
    fixture.remember("b");
    fixture.load("a");
    fixture.load("b");
    fixture.setLoading("a", true);

    fixture.memory.touchSelection("b");

    expect(fixture.evicted).toEqual([]);
  });

  it("protects the whole selected family when a child is selected", () => {
    const fixture = setup(1);
    fixture.remember("root");
    fixture.remember("child", "root");
    fixture.remember("other");
    fixture.load("root");
    fixture.load("child");
    fixture.load("other");

    fixture.memory.touchSelection("child");

    expect(fixture.evicted).toEqual(["other"]);
    expect(fixture.data.session.message.list("root").length).toBeGreaterThan(0);
    expect(fixture.data.session.message.list("child").length).toBeGreaterThan(0);
  });

  it("guards a family root that has no catalog record", () => {
    const fixture = setup(1);
    fixture.remember("child", "root");
    fixture.remember("other");
    fixture.load("child");
    fixture.load("other");
    fixture.setPending("root");

    fixture.memory.touchSelection("other");

    expect(fixture.evicted).toEqual([]);
    expect(fixture.data.session.message.list("child").length).toBeGreaterThan(0);
  });

  it("guards a family member that is absent from the catalog", () => {
    const fixture = setup(1);
    fixture.remember("root");
    fixture.remember("child", "root");
    fixture.remember("other");
    fixture.hideFromCatalog("child");
    fixture.load("child");
    fixture.load("other");
    fixture.setPending("child");

    fixture.memory.touchSelection("other");

    expect(fixture.evicted).toEqual([]);
    expect(fixture.data.session.message.list("child").length).toBeGreaterThan(0);
  });

  it("reconciles a deleted family after a late read settles", async () => {
    const fixture = setup(1);
    fixture.remember("gone");
    fixture.remember("kept");
    const gate = deferred();
    const read = fixture.effects.runPromise(
      fixture.reads.track(
        "gone",
        Effect.promise(() => gate.promise),
      ),
    );
    fixture.memory.touchSelection("gone");
    fixture.memory.touchSelection("kept");

    fixture.emitDeleted("gone");
    fixture.load("gone");
    gate.resolve();
    await read;

    expect(fixture.evicted).toEqual(["gone"]);
  });
});
