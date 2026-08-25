import type { OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "./event-source.ts";
import { createSessionCatalog } from "./session-catalog.ts";

const location = { directory: "/workspace" } as const;

const session = (id: string): SessionInfo =>
  ({
    id,
    projectID: "project",
    cost: 0,
    tokens: {},
    time: { created: 1, updated: 1 },
    location,
  }) as SessionInfo;

describe("session catalog reconciliation", () => {
  it("replays create and delete events that race a server snapshot", async () => {
    type Page = Awaited<ReturnType<OpenCodeClient["session"]["list"]>>;
    let resolvePage!: (page: Page) => void;
    const page = new Promise<Page>((resolve) => {
      resolvePage = resolve;
    });
    const remember = vi.fn();
    const sync = vi.fn(() => Promise.resolve());
    const api = {
      session: { list: vi.fn(() => page) },
    } as unknown as OpenCodeClient;
    const data = {
      session: { remember, sync },
    } as unknown as Data;
    const events = createOpenCodeEventSource();

    await new Promise<void>((resolveTest, rejectTest) => {
      createRoot((dispose) => {
        const catalog = createSessionCatalog({ api, data, defaultLocation: location, events });
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

        resolvePage({
          data: [session("kept"), session("deleted")],
          cursor: {},
        });

        void pending
          .then(() => {
            expect(catalog.ids()).toEqual(["kept", "new"]);
            expect(remember).toHaveBeenCalledTimes(1);
            expect(sync).toHaveBeenCalledWith("new");
            dispose();
            resolveTest();
          })
          .catch(rejectTest);
      });
    });
  });
});
