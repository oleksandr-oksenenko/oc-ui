import type { LocationRef, OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "./event-source.ts";
import { createSessionCatalog } from "./session-catalog.ts";

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

    expect(catalogIds).toEqual(["kept", "other-session", "new", "other"]);
    expect(api.session.list).toHaveBeenCalledWith({
      parentID: null,
      order: "desc",
      limit: 100,
      cursor: undefined,
    });
    expect(remember).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledWith("new");
    expect(sync).toHaveBeenCalledWith("other");
  });
});
