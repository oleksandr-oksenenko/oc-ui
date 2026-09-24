import { Effect, Exit, Scope } from "effect";
import type { OpenCodeEvent, PermissionReply, PermissionRequest } from "@opencode/client";
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
function asked(request: PermissionRequest): AskedEvent {
  return {
    id: `event-asked-${request.id}`,
    created: 1,
    type: "permission.asked",
    data: request,
  };
}
function setup(
  options: {
    readonly selectedID?: string;
    readonly subagentIDs?: readonly string[];
    readonly connected?: boolean;
    readonly listed?: Record<string, PermissionRequest[]>;
    readonly sessionSync?: PermissionData["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [subagentIDs, setSubagentIDs] = createSignal<readonly string[]>(
      options.subagentIDs ?? [],
    );
    const [connected, setConnected] = createSignal(options.connected ?? true);
    const [listed, setListedState] = createSignal<Record<string, PermissionRequest[]>>(
      options.listed ?? {},
    );
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
      subagentIDs,
      connected,
      data: {
        on: events.on,
        session: {
          permission: {
            list: (id) => listed()[id],
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
      setSubagentIDs,
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

describe("createPermissions subagent bubbling", () => {
  it("projects subagent requests after the selected session's own and hides unrelated sessions", async () => {
    const own = permission("own", "one");
    const subagent = permission("sub", "child");
    const unrelated = permission("unrelated", "other");
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [own], child: [subagent], other: [unrelated] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    expect(fixture.permissions.requests()).toEqual([own, subagent]);
    fixture.dispose();
  });

  it("routes a subagent reply through its owning session", async () => {
    const subagent = permission("sub", "child", ["/tmp/**"]);
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [], child: [subagent] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    await fixture.permissions.reply("sub", "always");
    expect(fixture.reply).toHaveBeenCalledExactlyOnceWith({
      sessionID: "child",
      requestID: "sub",
      reply: "always",
    });
    expect(fixture.permissions.requests()).toEqual([]);
    fixture.dispose();
  });

  it("syncs a trusted subagent on permission events and ignores unrelated sessions", async () => {
    const subagent = permission("sub", "child");
    const unrelated = permission("other", "other");
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      sessionSync: async (sessionID) => {
        if (sessionID === "child") fixture.setListed("child", [subagent]);
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.emitAsked(asked(unrelated));
    await Promise.resolve();
    expect(fixture.sessionSync).not.toHaveBeenCalledWith("other");

    fixture.emitAsked(asked(subagent));
    await vi.waitFor(() => expect(fixture.permissions.requests()).toEqual([subagent]));
    expect(fixture.sessionInvalidate).toHaveBeenCalledWith("child");
    expect(fixture.sessionSync).toHaveBeenCalledWith("child");
    fixture.dispose();
  });

  it("hydrates unloaded subagent caches when connected and re-checks on reconnect", async () => {
    const subagent = permission("sub", "child");
    const fixture = setup({
      selectedID: "one",
      sessionSync: async (sessionID) => {
        if (sessionID === "child") fixture.setListed("child", [subagent]);
      },
    });
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledWith("one"));

    fixture.setConnected(false);
    fixture.setSubagentIDs(["child"]);
    await Promise.resolve();
    expect(fixture.sessionSync).not.toHaveBeenCalledWith("child");

    fixture.setConnected(true);
    await vi.waitFor(() => expect(fixture.permissions.requests()).toEqual([subagent]));
    expect(fixture.sessionSync).toHaveBeenCalledWith("child");
    fixture.dispose();
  });

  it("recovers a blocked subagent reply without changing the selected session status", async () => {
    const subagent = permission("sub", "child");
    let available = false;
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [], child: [subagent] },
      sessionSync: async (sessionID) => {
        if (sessionID === "child" && !available) throw new Error("offline");
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    fixture.reply.mockRejectedValueOnce(new Error("reply failed"));
    await fixture.permissions.reply("sub", "once");

    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.recoveryError()).toContain("permission response");
    expect(fixture.permissions.state()).toBe("ready");

    available = true;
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.state()).toBe("ready");
    expect(fixture.permissions.errorFor("sub")).toContain("could not be sent");
    fixture.dispose();
  });

  it("rejects Always replies without saved patterns from subagents too", async () => {
    const subagent = permission("sub", "child");
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [], child: [subagent] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    await fixture.permissions.reply("sub", "always");
    expect(fixture.reply).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("fences an externally replied subagent request against stale snapshots", async () => {
    const request = permission("sub", "child");
    const replacement = permission("next", "child");
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [], child: [request] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    expect(fixture.permissions.requests()).toEqual([request]);

    fixture.emitReplied(replied(request));
    expect(fixture.permissions.requests()).toEqual([]);

    // A racing snapshot may republish the request; the fence keeps it hidden.
    fixture.setListed("child", [request]);
    expect(fixture.permissions.requests()).toEqual([]);

    // The next authoritative child read drops the fence and keeps it gone.
    fixture.setListed("child", [replacement]);
    fixture.emitAsked(asked(replacement));
    await vi.waitFor(() => expect(fixture.permissions.requests()).toEqual([replacement]));

    // A later snapshot may list the old request again; the cleared fence shows it.
    fixture.setListed("child", [request, replacement]);
    expect(fixture.permissions.requests()).toEqual([request, replacement]);
    fixture.dispose();
  });

  it("bounds concurrent subagent reads across event bursts", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const listed: Record<string, PermissionRequest[]> = {};
    for (const id of ids) listed[id] = [];
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ids,
      listed,
      sessionSync: (sessionID) =>
        sessionID === "one"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              started.push(sessionID);
              releases.push(resolve);
            }),
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    for (const id of ids) fixture.emitAsked(asked(permission(`req-${id}`, id)));
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(new Set(started)).toEqual(new Set(["a", "b", "c", "d"]));

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(started).toHaveLength(6));
    releases.splice(0).forEach((release) => release());
    fixture.dispose();
  });

  it("cancels queued descendant hydration when the subtree shrinks", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const fixture = setup({
      selectedID: "one",
      sessionSync: (sessionID) =>
        sessionID === "one"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              started.push(sessionID);
              releases.push(resolve);
            }),
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.setSubagentIDs(["a", "b", "c", "d", "e", "f"]);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    fixture.setSubagentIDs([]);
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(4);
    fixture.dispose();
  });

  it("skips queued descendant event reads after the subtree shrinks", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const listed: Record<string, PermissionRequest[]> = {};
    for (const id of ids) listed[id] = [];
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ids,
      listed,
      sessionSync: (sessionID) =>
        sessionID === "one"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              started.push(sessionID);
              releases.push(resolve);
            }),
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    for (const id of ids) fixture.emitAsked(asked(permission(`req-${id}`, id)));
    await vi.waitFor(() => expect(started).toHaveLength(4));
    fixture.setSubagentIDs(["a", "b", "c", "d"]);
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(4);
    fixture.dispose();
  });

  it("keeps queued hydration alive when retrying a failed descendant", async () => {
    const releases: Array<() => void> = [];
    const sessionSync = vi.fn<PermissionData["sync"]>((sessionID) => {
      if (sessionID === "one") return Promise.resolve();
      if (sessionID === "a") return Promise.reject(new Error("offline"));
      return new Promise<void>((resolve) => releases.push(resolve));
    });
    const fixture = setup({ selectedID: "one", sessionSync });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.setSubagentIDs(["a", "b", "c", "d", "e", "f"]);
    await vi.waitFor(() =>
      expect(sessionSync.mock.calls.some(([sessionID]) => sessionID === "e")).toBe(true),
    );
    expect(sessionSync.mock.calls.some(([sessionID]) => sessionID === "f")).toBe(false);
    await vi.waitFor(() =>
      expect(fixture.permissions.subagentError()).toBe(
        "Some subagent requests could not be loaded.",
      ),
    );

    const retry = fixture.permissions.retrySubagents();
    try {
      for (let round = 0; round < 6; round += 1) {
        releases.splice(0).forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(sessionSync.mock.calls.some(([sessionID]) => sessionID === "f")).toBe(true);
    } finally {
      releases.splice(0).forEach((release) => release());
      await retry;
      fixture.dispose();
    }
  });

  it("reports a failed descendant load and recovers it on retry", async () => {
    const subagent = permission("sub", "child");
    let available = false;
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      sessionSync: async (sessionID) => {
        if (sessionID !== "child") return;
        if (!available) throw new Error("offline");
        fixture.setListed("child", [subagent]);
      },
    });
    await vi.waitFor(() =>
      expect(fixture.permissions.subagentError()).toBe(
        "Some subagent requests could not be loaded.",
      ),
    );

    available = true;
    await fixture.permissions.retrySubagents();
    expect(fixture.permissions.subagentError()).toBeUndefined();
    expect(fixture.permissions.requests()).toEqual([subagent]);
    fixture.dispose();
  });

  it("ignores a late descendant failure after the session leaves the subtree", async () => {
    const childRead = deferred();
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: { one: [], child: [] },
      sessionSync: (sessionID) => (sessionID === "child" ? childRead.promise : Promise.resolve()),
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    fixture.emitAsked(asked(permission("req", "child")));
    await vi.waitFor(() => expect(fixture.sessionSync).toHaveBeenCalledWith("child"));
    fixture.setSubagentIDs([]);
    childRead.reject(new Error("offline"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.permissions.subagentError()).toBeUndefined();

    // Re-adding a loaded child must not resurface the departed session's failure.
    fixture.setSubagentIDs(["child"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.permissions.subagentError()).toBeUndefined();
    fixture.dispose();
  });
});
