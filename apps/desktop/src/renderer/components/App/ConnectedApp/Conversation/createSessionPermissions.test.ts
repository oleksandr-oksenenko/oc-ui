import { Effect, Exit, Scope } from "effect";
import type { OpenCodeEvent, PermissionReply, PermissionRequest } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createSessionPermissions } from "./createSessionPermissions.ts";

type PermissionsInput = Parameters<typeof createSessionPermissions>[0];
type PermissionData = PermissionsInput["data"]["session"]["permission"];
type AskedEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>;
type RepliedEvent = Extract<OpenCodeEvent, { type: "permission.replied" }>;

function permission(id: string, sessionID: string): PermissionRequest {
  return {
    id,
    sessionID,
    action: "read",
    resources: [`/tmp/${id}`],
  };
}

function setup(
  options: {
    readonly selectedID?: string;
    readonly listed?: Record<string, PermissionRequest[]>;
    readonly sync?: PermissionData["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [connected, setConnected] = createSignal(true);
    const [listed, setListedState] = createSignal(options.listed ?? {});
    const sync = vi.fn<PermissionData["sync"]>(options.sync ?? (() => Promise.resolve()));
    const invalidate = vi.fn<PermissionData["invalidate"]>();
    const list = vi.fn<PermissionData["list"]>((sessionID) => listed()[sessionID] ?? []);
    const reply = vi.fn<PermissionData["reply"]>(async (input) => {
      setListedState((current) => ({
        ...current,
        [input.sessionID]: (current[input.sessionID] ?? []).filter(
          (request) => request.id !== input.requestID,
        ),
      }));
    });
    const events = createOpenCodeEventSource();
    const permissions = createSessionPermissions({
      effects,
      data: { on: events.on, session: { permission: { list, sync, invalidate, reply } } },
      selectedID,
      connected,
    });

    return {
      effects,
      dispose,
      permissions,
      setSelectedID,
      setConnected,
      setListed(sessionID: string, requests: PermissionRequest[]) {
        setListedState((current) => ({ ...current, [sessionID]: requests }));
      },
      sync,
      invalidate,
      reply,
      emitAsked(event: AskedEvent) {
        events.emit(event);
      },
      emitReplied(event: RepliedEvent) {
        events.emit(event);
      },
    };
  });
}

function asked(request: PermissionRequest): AskedEvent {
  return {
    id: `event-asked-${request.id}`,
    created: 1,
    type: "permission.asked",
    data: request,
  };
}

function replied(request: PermissionRequest, reply: PermissionReply = "once"): RepliedEvent {
  return {
    id: `event-replied-${request.id}`,
    created: 1,
    type: "permission.replied",
    data: { sessionID: request.sessionID, requestID: request.id, reply },
  };
}

describe("createSessionPermissions", () => {
  it("loads on initial selection, selection changes, and reconnect", async () => {
    const first = deferred();
    const second = deferred();
    const fixture = setup({
      selectedID: "one",
      sync: vi
        .fn<PermissionData["sync"]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockResolvedValue(undefined),
    });

    expect(fixture.permissions.state()).toBe("loading");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("two"));
    first.reject(new Error("stale"));
    expect(fixture.permissions.state()).toBe("loading");
    second.resolve();
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.setConnected(false);
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.setConnected(true);
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledTimes(3));
    expect(fixture.permissions.state()).toBe("ready");
    fixture.dispose();
  });

  it("invalidates asked events and fences replied events across stale snapshots", async () => {
    const request = permission("request", "one");
    const stale = deferred();
    const replacement = deferred();
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request] },
      sync: vi
        .fn<PermissionData["sync"]>()
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(replacement.promise)
        .mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledOnce());

    fixture.emitAsked(asked(permission("new", "one")));
    expect(fixture.invalidate).toHaveBeenCalledWith("one");
    fixture.emitReplied(replied(request));
    expect(fixture.permissions.requests()).toEqual([]);
    stale.resolve();
    replacement.resolve();
    await Promise.resolve();
    expect(fixture.permissions.requests()).toEqual([]);

    fixture.setListed("one", []);
    await fixture.permissions.sync();
    fixture.setListed("one", [request]);
    expect(fixture.permissions.requests()).toEqual([request]);
    fixture.dispose();
  });

  it("keeps cached requests through a refresh failure and recovers on retry", async () => {
    const request = permission("cached", "one");
    const failed = deferred();
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request] },
      sync: vi
        .fn<PermissionData["sync"]>()
        .mockReturnValueOnce(failed.promise)
        .mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledOnce());
    failed.reject(new Error("offline"));
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("failed"));
    expect(fixture.permissions.requests()).toEqual([request]);
    expect(fixture.permissions.error()).toBe("Permissions could not be refreshed. Try again.");

    await fixture.permissions.sync();
    expect(fixture.permissions.state()).toBe("ready");
    expect(fixture.permissions.error()).toBeUndefined();
    fixture.dispose();
  });

  it("sends once, always, and reject replies through the pinned data helper", async () => {
    const requests: PermissionRequest[] = [
      permission("once", "one"),
      { ...permission("always", "one"), save: ["/tmp/always"] },
      permission("reject", "one"),
      permission("always-without-save", "one"),
      { ...permission("always-with-mixed-save", "one"), save: ["", "src/**"] },
    ];
    const fixture = setup({ selectedID: "one", listed: { one: requests } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    await fixture.permissions.reply("always-without-save", "always");
    await fixture.permissions.reply("always-with-mixed-save", "always");
    expect(fixture.reply).not.toHaveBeenCalled();
    for (const response of ["once", "always", "reject"] as const) {
      await fixture.permissions.reply(response, response);
    }
    expect(fixture.reply.mock.calls.map(([input]) => input)).toEqual([
      { sessionID: "one", requestID: "once", reply: "once" },
      { sessionID: "one", requestID: "always", reply: "always" },
      { sessionID: "one", requestID: "reject", reply: "reject" },
    ]);
    expect(fixture.invalidate).toHaveBeenCalledWith("one");
    fixture.dispose();
  });

  it("uses one workspace lock and rejects duplicate or cross-session responses", async () => {
    const first = { ...permission("first", "one"), save: ["/tmp/first"] };
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

    const pending = fixture.permissions.reply(first.id, "always");
    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.submitting(first.id)).toBe(true);
    void fixture.permissions.reply(first.id, "once");
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.reply(second.id, "reject");
    expect(fixture.reply).toHaveBeenCalledOnce();
    expect(fixture.permissions.pending()).toBe(true);

    response.resolve();
    await pending;
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.submitting(second.id)).toBe(false);
    fixture.dispose();
  });

  it("restores a fenced request with a scoped retry error after a failed reply", async () => {
    const request = permission("request", "one");
    const response = deferred();
    const fixture = setup({ selectedID: "one", listed: { one: [request] } });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockReturnValueOnce(response.promise);

    const pending = fixture.permissions.reply(request.id, "once");
    fixture.emitReplied(replied(request));
    expect(fixture.permissions.requests()).toEqual([]);
    response.reject(new Error("saved rule failed after replied event"));
    await pending;

    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.requests()).toEqual([request]);
    expect(fixture.permissions.errorFor(request.id)).toBe(
      "The permission response could not be sent. Try again.",
    );

    fixture.setListed("one", []);
    fixture.emitReplied(replied(request));
    await vi.waitFor(() => expect(fixture.permissions.errorFor(request.id)).toBeUndefined());
    fixture.dispose();
  });

  it("treats an applied response with a lost transport response as settled", async () => {
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

  it("keeps failed reconciliation blocked across navigation until the origin syncs", async () => {
    const request = permission("request", "one");
    let originAvailable = false;
    let originCalls = 0;
    const fixture = setup({
      selectedID: "one",
      listed: { one: [request], two: [permission("other", "two")] },
      sync: async (sessionID) => {
        if (sessionID !== "one") return;
        originCalls += 1;
        if (originCalls > 1 && !originAvailable) throw new Error("origin unavailable");
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockRejectedValueOnce(new Error("reply failed"));

    await fixture.permissions.reply(request.id, "once");
    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.submitting(request.id)).toBe(false);
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("two"));
    expect(fixture.permissions.state()).toBe("failed");
    expect(fixture.permissions.error()).toBe("Permissions could not be refreshed. Try again.");
    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("failed"));
    expect(fixture.permissions.pending()).toBe(true);

    originAvailable = true;
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.errorFor(request.id)).toBe(
      "The permission response could not be sent. Try again.",
    );
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
