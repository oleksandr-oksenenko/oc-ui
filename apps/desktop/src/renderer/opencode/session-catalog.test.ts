import type { LocationRef, OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "./event-source.ts";
import { createSessionCatalog, syncActiveStatuses } from "./session-catalog.ts";

const location = { directory: "/workspace" } as const;

const session = (id: string, sessionLocation: LocationRef = location, parentID?: string) => {
  const info: SessionInfo = {
    id,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: sessionLocation,
  };
  return parentID === undefined ? info : { ...info, parentID };
};

describe("session catalog reconciliation", () => {
  it("replays create and delete events that race a server snapshot", async () => {
    type Page = Awaited<ReturnType<OpenCodeClient["session"]["list"]>>;
    let resolvePage!: (page: Page) => void;
    const page = new Promise<Page>((resolve) => {
      resolvePage = resolve;
    });
    const remember = vi.fn<Data["session"]["remember"]>();
    const sync = vi.fn<Data["session"]["sync"]>(() => Promise.resolve());
    const api = {
      session: { list: vi.fn<OpenCodeClient["session"]["list"]>(() => page) },
    };
    const data = {
      session: { remember, sync },
    };
    const events = createOpenCodeEventSource();

    let catalogIds: readonly string[] = [];
    await new Promise<void>((resolveTest, rejectTest) => {
      createRoot((dispose) => {
        const catalog = createSessionCatalog({ api, data, events });
        const pending = catalog.sync();

        events.emit({
          id: "event-created",
          created: 2,
          type: "session.created",
          durable: { aggregateID: "new", seq: 1, version: 1 },
          data: {
            sessionID: "new",
            projectID: "project",
            location,
            slug: "new",
            version: "1",
          },
        } satisfies OpenCodeEvent);
        events.emit({
          id: "event-deleted",
          created: 3,
          type: "session.deleted",
          durable: { aggregateID: "deleted", seq: 2, version: 2 },
          data: { sessionID: "deleted" },
        } satisfies OpenCodeEvent);
        events.emit({
          id: "event-created-other-location",
          created: 4,
          type: "session.created",
          durable: { aggregateID: "other", seq: 3, version: 1 },
          data: {
            sessionID: "other",
            projectID: "project",
            location: { directory: "/other-workspace" },
            slug: "other",
            version: "1",
          },
        } satisfies OpenCodeEvent);
        events.emit({
          id: "event-created-child",
          created: 5,
          type: "session.created",
          durable: { aggregateID: "child", seq: 4, version: 1 },
          data: {
            sessionID: "child",
            projectID: "project",
            location: { directory: "/other-workspace" },
            parentID: "parent",
            slug: "child",
            version: "1",
          },
        } satisfies OpenCodeEvent);

        resolvePage({
          data: [
            session("kept"),
            session("other-session", { directory: "/other-workspace" }),
            session("child-session", { directory: "/other-workspace" }, "parent"),
            session("deleted"),
          ],
          cursor: {},
        });

        void pending
          .then(() => {
            catalogIds = catalog.ids();
            dispose();
            resolveTest();
            return undefined;
          })
          .catch(rejectTest);
      });
    });

    expect(catalogIds).toEqual(["kept", "other-session", "child-session", "new", "other", "child"]);
    expect(api.session.list).toHaveBeenCalledWith({
      order: "desc",
      limit: 100,
      cursor: undefined,
    });
    expect(remember).toHaveBeenCalledTimes(3);
    expect(sync).toHaveBeenCalledWith("new");
    expect(sync).toHaveBeenCalledWith("other");
    expect(sync).toHaveBeenCalledWith("child");
  });

  it("loads every unfiltered page once and de-duplicates overlapping rows", async () => {
    const remember = vi.fn<Data["session"]["remember"]>();
    const list = vi
      .fn<OpenCodeClient["session"]["list"]>()
      .mockResolvedValueOnce({
        data: [session("root"), session("child", location, "root")],
        cursor: { next: "next" },
      })
      .mockResolvedValueOnce({
        data: [session("child", location, "root"), session("grandchild", location, "child")],
        cursor: {},
      });
    const catalog = createSessionCatalog({
      api: { session: { list } },
      data: {
        session: {
          remember,
          sync: vi.fn<Data["session"]["sync"]>(() => Promise.resolve()),
        },
      },
      events: createOpenCodeEventSource(),
    });

    expect(catalog.state()).toBe("loading");
    await catalog.sync();

    expect(catalog.state()).toBe("ready");
    expect(catalog.ids()).toEqual(["root", "child", "grandchild"]);
    expect(list).toHaveBeenNthCalledWith(1, {
      order: "desc",
      limit: 100,
      cursor: undefined,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      order: "desc",
      limit: 100,
      cursor: "next",
    });
    expect(remember).toHaveBeenCalledTimes(3);
  });

  it("admits and removes child sessions from live events after hydration", async () => {
    const sync = vi.fn<Data["session"]["sync"]>(() => Promise.resolve());
    const events = createOpenCodeEventSource();
    const catalog = createSessionCatalog({
      api: {
        session: {
          list: vi.fn<OpenCodeClient["session"]["list"]>().mockResolvedValue({
            data: [session("root")],
            cursor: {},
          }),
        },
      },
      data: {
        session: {
          remember: vi.fn<Data["session"]["remember"]>(),
          sync,
        },
      },
      events,
    });

    await catalog.sync();
    events.emit({
      id: "child-created",
      created: 2,
      type: "session.created",
      durable: { aggregateID: "child", seq: 1, version: 1 },
      data: {
        sessionID: "child",
        projectID: "project",
        location,
        parentID: "root",
        slug: "child",
        version: "1",
      },
    } satisfies OpenCodeEvent);

    expect(catalog.ids()).toEqual(["root", "child"]);
    expect(sync).toHaveBeenCalledWith("child");

    events.emit({
      id: "child-deleted",
      created: 3,
      type: "session.deleted",
      durable: { aggregateID: "child", seq: 2, version: 2 },
      data: { sessionID: "child" },
    } satisfies OpenCodeEvent);

    expect(catalog.ids()).toEqual(["root"]);
  });

  it("replaces the catalog with child changes missed while disconnected", async () => {
    const list = vi
      .fn<OpenCodeClient["session"]["list"]>()
      .mockResolvedValueOnce({ data: [session("root")], cursor: {} })
      .mockResolvedValueOnce({
        data: [session("root"), session("child", location, "root")],
        cursor: {},
      })
      .mockResolvedValueOnce({ data: [session("root")], cursor: {} });
    const catalog = createSessionCatalog({
      api: { session: { list } },
      data: {
        session: {
          remember: vi.fn<Data["session"]["remember"]>(),
          sync: vi.fn<Data["session"]["sync"]>(() => Promise.resolve()),
        },
      },
      events: createOpenCodeEventSource(),
    });

    await catalog.sync();
    expect(catalog.ids()).toEqual(["root"]);

    await catalog.sync();
    expect(catalog.ids()).toEqual(["root", "child"]);

    await catalog.sync();
    expect(catalog.ids()).toEqual(["root"]);
  });

  it("synchronizes status for child sessions as well as roots", async () => {
    const setStatus = vi.fn<Data["session"]["setStatus"]>();
    const active = vi.fn<OpenCodeClient["session"]["active"]>().mockResolvedValue({
      child: { type: "running" },
    });

    await syncActiveStatuses({
      api: { session: { active } },
      data: { session: { setStatus } },
      sessionIDs: ["root", "child"],
    });

    expect(setStatus.mock.calls).toEqual([
      ["root", "idle"],
      ["child", "idle"],
      ["child", "running"],
    ]);
  });
});
