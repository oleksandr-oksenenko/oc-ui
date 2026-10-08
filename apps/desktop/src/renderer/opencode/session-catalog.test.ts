import {
  OpenCode,
  type LocationRef,
  type OpenCodeClient,
  type OpenCodeEvent,
  type SessionInfo,
} from "@opencode/client";
import { createData, type Data } from "@opencode/client/solid";
import { Effect, Exit, Scope } from "effect";
import { createComputed } from "solid-js";
import { withTestWorkspace } from "../test/workspace.ts";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../test/deferred.ts";
import { sessionFixture } from "../test/session-fixture.ts";
import { createOpenCodeEventSource } from "./event-source.ts";
import { createSessionCatalog, syncActiveStatuses } from "./session-catalog.ts";

const location = { directory: "/workspace" } as const;

const session = (id: string, sessionLocation: LocationRef = location, parentID?: string) => {
  const info: SessionInfo = sessionFixture({
    id,
    location: sessionLocation,
  });
  return parentID === undefined ? info : { ...info, parentID };
};

describe("session catalog reconciliation", () => {
  it("publishes the first page with one SDK list update while the next page is pending", async () => {
    const nextPage = deferred<Awaited<ReturnType<OpenCodeClient["session"]["list"]>>>();
    const api = OpenCode.make({ baseUrl: "http://catalog.test" });
    const rows = Array.from({ length: 100 }, (_, index) => session(`session-${index}`));
    const list = vi
      .spyOn(api.session, "list")
      .mockResolvedValueOnce({ data: rows, cursor: { next: "older" } })
      .mockReturnValueOnce(nextPage.promise);
    const observed: number[] = [];
    const catalog = withTestWorkspace((effects) => {
      const events = createOpenCodeEventSource();
      const data = createData({
        api: () => api,
        directory: location.directory,
        event: events,
        connection: { status: () => "connected" },
      });
      createComputed(() => observed.push(data.session.list().length));
      return createSessionCatalog({ effects, api, data, events });
    });
    const pending = catalog.sync();
    try {
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      expect(observed).toEqual([0, 100]);
      expect(catalog.ids()).toEqual(rows.map((info) => info.id));
      expect(catalog.state()).toBe("loading");
    } finally {
      nextPage.resolve({ data: [session("older")], cursor: {} });
      await pending;
    }
    expect(observed).toEqual([0, 100, 101]);
    expect(catalog.ids()).toHaveLength(101);
    expect(catalog.state()).toBe("ready");
  });

  it.each(["failure", "success"])(
    "preserves live mutations across pages on %s and reconciles on refresh",
    async (outcome) => {
      const nextPage = deferred<Awaited<ReturnType<OpenCodeClient["session"]["list"]>>>();
      const list = vi
        .fn<OpenCodeClient["session"]["list"]>()
        .mockResolvedValueOnce({
          data: [session("kept"), session("deleted")],
          cursor: { next: "older" },
        })
        .mockReturnValueOnce(nextPage.promise);
      const remember = vi.fn<Data["session"]["remember"]>();
      const catalog = withTestWorkspace((effects) =>
        createSessionCatalog({
          effects,
          api: { session: { list } },
          data: { session: { remember, sync: async () => undefined } },
          events: createOpenCodeEventSource(),
        }),
      );
      const pending = catalog.sync();
      const settled = Promise.allSettled([pending]);
      try {
        await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
        expect(catalog.ids()).toEqual(["kept", "deleted"]);
        catalog.remove("deleted");
        catalog.admit("created");
      } finally {
        if (outcome === "failure") nextPage.reject(new Error("offline"));
        else
          nextPage.resolve({
            data: [session("kept"), session("deleted"), session("older")],
            cursor: {},
          });
        await settled;
      }
      expect(catalog.state()).toBe(outcome === "failure" ? "failed" : "ready");
      expect(catalog.ids()).toEqual(
        outcome === "failure" ? ["kept", "created"] : ["kept", "older", "created"],
      );
      expect(remember.mock.calls.map(([info]) => info.id)).toEqual(
        outcome === "failure" ? ["kept", "deleted"] : ["kept", "deleted", "older"],
      );
      list.mockResolvedValueOnce({ data: [session("created")], cursor: {} });
      await catalog.sync();
      expect(catalog.state()).toBe("ready");
      expect(catalog.ids()).toEqual(["created"]);
    },
  );

  it("replays create and delete events that race a server snapshot", async () => {
    type Page = Awaited<ReturnType<OpenCodeClient["session"]["list"]>>;
    const page = deferred<Page>();
    const remember = vi.fn<Data["session"]["remember"]>();
    const sync = vi.fn<Data["session"]["sync"]>(() => Promise.resolve());
    const api = {
      session: { list: vi.fn<OpenCodeClient["session"]["list"]>(() => page.promise) },
    };
    const data = {
      session: { remember, sync },
    };
    const events = createOpenCodeEventSource();

    let catalogIds: readonly string[] = [];
    await new Promise<void>((resolveTest, rejectTest) => {
      withTestWorkspace((effects, dispose) => {
        const catalog = createSessionCatalog({ effects, api, data, events });
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

        page.resolve({
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
    expect(api.session.list).toHaveBeenCalledWith(
      {
        order: "desc",
        limit: 100,
        cursor: undefined,
      },
      { signal: expect.any(AbortSignal) },
    );
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
    const catalog = withTestWorkspace((effects) =>
      createSessionCatalog({
        effects,
        api: { session: { list } },
        data: {
          session: {
            remember,
            sync: vi.fn<Data["session"]["sync"]>(() => Promise.resolve()),
          },
        },
        events: createOpenCodeEventSource(),
      }),
    );

    expect(catalog.state()).toBe("loading");
    await catalog.sync();

    expect(catalog.state()).toBe("ready");
    expect(catalog.ids()).toEqual(["root", "child", "grandchild"]);
    expect(list).toHaveBeenNthCalledWith(
      1,
      {
        order: "desc",
        limit: 100,
        cursor: undefined,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(list).toHaveBeenNthCalledWith(
      2,
      {
        order: "desc",
        limit: 100,
        cursor: "next",
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(remember).toHaveBeenCalledTimes(3);
  });

  it("admits and removes child sessions from live events after hydration", async () => {
    const sync = vi.fn<Data["session"]["sync"]>(() => Promise.resolve());
    const events = createOpenCodeEventSource();
    const catalog = withTestWorkspace((effects) =>
      createSessionCatalog({
        effects,
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
      }),
    );

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
    const catalog = withTestWorkspace((effects) =>
      createSessionCatalog({
        effects,
        api: { session: { list } },
        data: {
          session: {
            remember: vi.fn<Data["session"]["remember"]>(),
            sync: vi.fn<Data["session"]["sync"]>(() => Promise.resolve()),
          },
        },
        events: createOpenCodeEventSource(),
      }),
    );

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

    await withTestWorkspace((effects) =>
      effects.runPromise(
        syncActiveStatuses({
          effects,
          api: { session: { active } },
          data: { session: { setStatus } },
          sessionIDs: ["root", "child"],
        }),
      ),
    );

    expect(setStatus.mock.calls).toEqual([
      ["root", "idle"],
      ["child", "idle"],
      ["child", "running"],
    ]);
  });
  it("shares a failed refresh, then allows a new explicit refresh", async () => {
    const page = deferred<Awaited<ReturnType<OpenCodeClient["session"]["list"]>>>();
    const list = vi.fn<OpenCodeClient["session"]["list"]>(() => page.promise);
    const catalog = withTestWorkspace((effects) =>
      createSessionCatalog({
        effects,
        api: { session: { list } },
        data: { session: { remember: () => undefined, sync: async () => undefined } },
        events: createOpenCodeEventSource(),
      }),
    );
    const reads = Promise.allSettled([catalog.sync(), catalog.sync()]);
    expect(list).toHaveBeenCalledOnce();
    page.reject(new Error("offline"));
    expect(await reads).toMatchObject([{ status: "rejected" }, { status: "rejected" }]);
    expect(catalog.state()).toBe("failed");
    list.mockResolvedValue({ data: [session("recovered")], cursor: {} });
    await catalog.sync();
    expect(list).toHaveBeenCalledTimes(2);
    expect(catalog.state()).toBe("ready");
    expect(catalog.ids()).toEqual(["recovered"]);
  });

  it.each([1, 2])(
    "cancels a shared catalog read on page %i and waits for native settlement on shutdown",
    async (pageNumber) => {
      const page = deferred<Awaited<ReturnType<OpenCodeClient["session"]["list"]>>>();
      const list = vi.fn<OpenCodeClient["session"]["list"]>(() => page.promise);
      if (pageNumber === 2) {
        list.mockResolvedValueOnce({ data: [session("kept")], cursor: { next: "older" } });
      }
      const remember = vi.fn<Data["session"]["remember"]>();
      const { catalog, owner } = withTestWorkspace((effects) => ({
        owner: effects,
        catalog: createSessionCatalog({
          effects,
          api: { session: { list } },
          data: { session: { remember, sync: async () => undefined } },
          events: createOpenCodeEventSource(),
        }),
      }));
      const first = catalog.sync().catch(() => undefined);
      const second = catalog.sync().catch(() => undefined);
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(pageNumber));
      const signal = list.mock.calls[pageNumber - 1]?.[1]?.signal;
      let closed = false;
      const closing = Effect.runPromise(Scope.close(owner.scope, Exit.void)).then(() => {
        closed = true;
        return undefined;
      });
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      expect(closed).toBe(false);
      page.resolve({ data: [session("stale")], cursor: {} });
      await Promise.all([closing, first, second]);
      expect(remember).toHaveBeenCalledTimes(pageNumber - 1);
      expect(catalog.ids()).toEqual(pageNumber === 1 ? [] : ["kept"]);
    },
  );
});
