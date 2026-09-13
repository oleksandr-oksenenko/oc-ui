import { Effect, Exit, Scope } from "effect";
import type { OpenCodeEvent, PermissionReply, PermissionRequest } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createPermissions, type PermissionsInput } from "./createPermissions.ts";

type PermissionData = PermissionsInput["data"]["session"]["permission"];
type AskedEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>;
type RepliedEvent = Extract<OpenCodeEvent, { type: "permission.replied" }>;

function permission(id: string, sessionID: string, save?: readonly string[]): PermissionRequest {
  const value = { id, sessionID, action: "read", resources: [`/tmp/${id}`] };
  return save === undefined ? value : { ...value, save: [...save] };
}
function replied(request: PermissionRequest, reply: PermissionReply = "once"): RepliedEvent {
  return {
    id: `event-replied-${request.id}`,
    created: 1,
    type: "permission.replied",
    data: { sessionID: request.sessionID, requestID: request.id, reply },
  };
}
function setup(
  options: {
    readonly selectedID?: string;
    readonly connected?: boolean;
    readonly listed?: Record<string, PermissionRequest[]>;
    readonly sessionSync?: PermissionData["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [connected, setConnected] = createSignal(options.connected ?? true);
    const [listed, setListedState] = createSignal(options.listed ?? {});
    const sessionSync = vi.fn<PermissionData["sync"]>(
      options.sessionSync ?? (() => Promise.resolve()),
    );
    const sessionInvalidate = vi.fn<PermissionData["invalidate"]>();
    const reply = vi.fn<PermissionData["reply"]>(async (input) => {
      setListedState((current) => ({
        ...current,
        [input.sessionID]: (current[input.sessionID] ?? []).filter(
          (request) => request.id !== input.requestID,
        ),
      }));
    });
    const events = createOpenCodeEventSource();
    const permissions = createPermissions({
      effects,
      selectedID,
      connected,
      data: {
        on: events.on,
        session: {
          permission: {
            list: (id) => listed()[id] ?? [],
            sync: sessionSync,
            invalidate: sessionInvalidate,
            reply,
          },
        },
      },
    });
    return {
      effects,
      dispose,
      permissions,
      sessionSync,
      sessionInvalidate,
      reply,
      setSelectedID,
      setConnected,
      setListed(sessionID: string, requests: PermissionRequest[]) {
        setListedState((current) => ({ ...current, [sessionID]: requests }));
      },
      emitAsked(event: AskedEvent) {
        events.emit(event);
      },
      emitReplied(event: RepliedEvent) {
        events.emit(event);
      },
    };
  });
}

describe("createPermissions", () => {
  it("loads on initial selection, selection changes, and reconnect", async () => {
    const first = deferred();
    const second = deferred();
    const fixture = setup({
      selectedID: "one",
      sessionSync: vi
        .fn<PermissionData["sync"]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockResolvedValue(undefined),
    });

    expect(fixture.permissions.state()).toBe("loading");
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledWith("one"));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledWith("two"));
    first.reject(new Error("stale"));
    expect(fixture.permissions.state()).toBe("loading");
    second.resolve();
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.setConnected(false);
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.setConnected(true);
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledTimes(3));
    fixture.dispose();
  });

  it("keeps cached selected requests through refresh failure and recovers on retry", async () => {
    const request = permission("cached", "one");
    const failed = deferred();
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request] },
      sessionSync: vi
        .fn<PermissionData["sync"]>()
        .mockReturnValueOnce(failed.promise)
        .mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledOnce());
    failed.reject(new Error("offline"));
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("failed"));
    expect(fixture.permissions.requests()).toEqual([request]);
    expect(fixture.permissions.error()).toBe("Permissions could not be refreshed. Try again.");

    await fixture.permissions.sync();
    expect(fixture.permissions.state()).toBe("ready");
    expect(fixture.permissions.error()).toBeUndefined();
    fixture.dispose();
  });

  it("routes valid replies and rejects invalid Always payloads", async () => {
    const requests = [
      permission("once", "one"),
      permission("always", "one", ["/tmp/**"]),
      permission("reject", "one"),
      permission("always-without-save", "one"),
      permission("always-with-empty-save", "one", ["", "src/**"]),
    ];
    const fixture = setup({ selectedID: "one", listed: { one: requests } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    await fixture.permissions.reply("always-without-save", "always");
    await fixture.permissions.reply("always-with-empty-save", "always");
    expect(fixture.reply).not.toHaveBeenCalled();
    for (const response of ["once", "always", "reject"] as const) {
      await fixture.permissions.reply(response, response);
    }
    expect(fixture.reply.mock.calls.map(([input]) => input)).toEqual([
      { sessionID: "one", requestID: "once", reply: "once" },
      { sessionID: "one", requestID: "always", reply: "always" },
      { sessionID: "one", requestID: "reject", reply: "reject" },
    ]);
    fixture.dispose();
  });

  it("uses one lock across duplicate and cross-session replies", async () => {
    const first = permission("first", "one");
    const second = permission("second", "two");
    const response = deferred();
    const fixture = setup({
      selectedID: "one",
      listed: { one: [first], two: [second] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockImplementationOnce((input) =>
      response.promise.then(() => fixture.setListed(input.sessionID, [])),
    );

    const pending = fixture.permissions.reply(first.id, "once");
    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.submitting(first.id)).toBe(true);
    void fixture.permissions.reply(first.id, "once");
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.reply(second.id, "reject");
    expect(fixture.reply).toHaveBeenCalledOnce();

    response.resolve();
    await pending;
    expect(fixture.permissions.pending()).toBe(false);
    fixture.dispose();
  });

  it("fences replied events across stale snapshots and restores failed replies", async () => {
    const request = permission("request", "one");
    const response = deferred();
    const fixture = setup({ selectedID: "one", listed: { one: [request] } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockReturnValueOnce(response.promise);

    const pending = fixture.permissions.reply(request.id, "once");
    fixture.emitReplied(replied(request));
    expect(fixture.permissions.requests()).toEqual([]);
    response.reject(new Error("failed"));
    await pending;

    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.requests()).toEqual([request]);
    expect(fixture.permissions.errorFor(request.id)).toBe(
      "The permission response could not be sent. Try again.",
    );
    fixture.dispose();
  });

  it("treats an applied reply with a lost response as settled", async () => {
    const request = permission("request", "one");
    const fixture = setup({ selectedID: "one", listed: { one: [request] } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockImplementationOnce(async () => {
      fixture.setListed("one", []);
      throw new Error("response lost");
    });

    await fixture.permissions.reply(request.id, "once");
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.requests()).toEqual([]);
    expect(fixture.permissions.errorFor(request.id)).toBeUndefined();
    fixture.dispose();
  });

  it("recovers a blocked current-session reply on refresh and restores cards", async () => {
    const request = permission("request", "one");
    let sessionReads = 0;
    let available = false;
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request] },
      sessionSync: async () => {
        sessionReads += 1;
        if (sessionReads > 1 && !available) throw new Error("offline");
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockRejectedValueOnce(new Error("reply failed"));
    await fixture.permissions.reply(request.id, "once");
    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.state()).toBe("failed");

    available = true;
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.state()).toBe("ready");
    expect(fixture.permissions.requests()).toEqual([request]);
    fixture.dispose();
  });

  it("keeps a blocked reply tied to its origin across navigation", async () => {
    const request = permission("request", "one");
    let originReads = 0;
    let available = false;
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request], two: [permission("other", "two")] },
      sessionSync: async (sessionID) => {
        if (sessionID !== "one") return;
        originReads += 1;
        if (originReads > 1 && !available) throw new Error("origin unavailable");
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockRejectedValueOnce(new Error("reply failed"));
    await fixture.permissions.reply(request.id, "once");
    expect(fixture.permissions.pending()).toBe(true);

    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    expect(fixture.permissions.recoveryError()).toContain("permission response");
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(true);

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("failed"));
    available = true;
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.errorFor(request.id)).toContain("could not be sent");
    fixture.dispose();
  });

  it("waits for non-cancellable reply I/O during workspace shutdown", async () => {
    const request = permission("request", "one");
    const response = deferred();
    const fixture = setup({ selectedID: "one", listed: { one: [request] } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockReturnValueOnce(response.promise);
    const operation = fixture.permissions.reply(request.id, "once").catch(() => undefined);

    fixture.dispose();
    const closed = vi.fn<() => void>();
    const shutdown = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(closed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).not.toHaveBeenCalled();

    response.resolve();
    await Promise.all([operation, shutdown]);
    expect(closed).toHaveBeenCalledOnce();
  });
});
