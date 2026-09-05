import { Effect, Exit, Scope } from "effect";
import type {
  LocationRef,
  OpenCodeEvent,
  PermissionReply,
  PermissionRequest,
  PermissionSavedInfo,
  Project,
  SessionInfo,
} from "@opencode-ai/client";
import { locationKey } from "@opencode-ai/client/solid";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { deferred } from "../../../../test/deferred.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createPermissions, type PermissionsInput } from "./createPermissions.ts";

type PermissionData = PermissionsInput["data"]["session"]["permission"];
type ProjectData = PermissionsInput["data"]["project"];
type RequestList = PermissionsInput["api"]["permission"]["request"]["list"];
type SavedRemove = PermissionsInput["api"]["permission"]["saved"]["remove"];
type LocationList = PermissionsInput["api"]["debug"]["location"]["list"];
type AskedEvent = Extract<OpenCodeEvent, { type: "permission.asked" }>;
type RepliedEvent = Extract<OpenCodeEvent, { type: "permission.replied" }>;

const defaultLocation: LocationRef = { directory: "/srv/default" };

function permission(id: string, sessionID: string, save?: readonly string[]): PermissionRequest {
  const value = {
    id,
    sessionID,
    action: "read",
    resources: [`/tmp/${id}`],
  };
  return save === undefined ? value : { ...value, save: [...save] };
}

function session(
  id: string,
  location: LocationRef = defaultLocation,
  projectID = `project-${id}`,
): SessionInfo {
  return sessionFixture({ id, projectID, location });
}

function project(id: string): Project {
  return {
    id,
    canonical: `/srv/${id}`,
    name: id,
    time: { created: 1, updated: 1 },
    sandboxes: [],
  };
}

function rule(id: string, projectID: string): PermissionSavedInfo {
  return { id, projectID, action: "read", resource: `/srv/${projectID}/**` };
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

function setup(
  options: {
    readonly selectedID?: string;
    readonly connected?: boolean;
    readonly catalogState?: "loading" | "ready" | "failed";
    readonly sessions?: readonly SessionInfo[];
    readonly listed?: Record<string, PermissionRequest[]>;
    readonly hydrated?: Record<string, PermissionRequest[]>;
    readonly sessionSync?: PermissionData["sync"];
    readonly locations?: ReadonlyMap<string, readonly PermissionRequest[]>;
    readonly loadedLocations?: readonly LocationRef[];
    readonly locationList?: LocationList;
    readonly requestList?: RequestList;
    readonly projects?: readonly Project[];
    readonly rules?: Record<string, PermissionSavedInfo[]>;
    readonly projectSync?: ProjectData["sync"];
    readonly ruleSync?: ProjectData["permission"]["sync"];
    readonly remove?: SavedRemove;
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [connected, setConnected] = createSignal(options.connected ?? true);
    const [catalogState, setCatalogState] = createSignal(options.catalogState ?? "loading");
    const [sessions, setSessions] = createSignal<readonly SessionInfo[]>(options.sessions ?? []);
    const [listed, setListedState] = createSignal(options.listed ?? {});
    const [projects, setProjects] = createSignal<readonly Project[]>(options.projects ?? []);
    const [rules, setRulesState] = createSignal<Record<string, PermissionSavedInfo[]>>(
      options.rules ?? {},
    );

    const sessionSync = vi.fn<PermissionData["sync"]>(
      options.sessionSync ??
        (async (sessionID) => {
          const hydrated = options.hydrated?.[sessionID];
          if (hydrated) {
            setListedState((current) => ({ ...current, [sessionID]: hydrated }));
          }
        }),
    );
    const sessionInvalidate = vi.fn<PermissionData["invalidate"]>();
    const sessionList = vi.fn<PermissionData["list"]>((sessionID) => listed()[sessionID] ?? []);
    const reply = vi.fn<PermissionData["reply"]>(async (input) => {
      setListedState((current) => ({
        ...current,
        [input.sessionID]: (current[input.sessionID] ?? []).filter(
          (request) => request.id !== input.requestID,
        ),
      }));
    });

    const requestList = vi.fn<RequestList>(
      options.requestList ??
        (async (input) => {
          const directory = input?.location?.directory ?? defaultLocation.directory;
          const workspaceID = input?.location?.workspace;
          const location: LocationRef =
            workspaceID === undefined ? { directory } : { directory, workspaceID };
          return {
            location: {
              ...location,
              project: {
                id: "project",
                directory: location.directory,
                canonical: location.directory,
              },
            },
            data: [...(options.locations?.get(locationKey(location)) ?? [])],
          };
        }),
    );
    const locationList = vi.fn<LocationList>(
      options.locationList ??
        (async () => [
          ...(options.loadedLocations ??
            new Map(
              sessions().map((item) => [locationKey(item.location), item.location]),
            ).values()),
        ]),
    );
    const projectSync = vi.fn<ProjectData["sync"]>(
      options.projectSync ?? (() => Promise.resolve()),
    );
    const projectInvalidate = vi.fn<ProjectData["invalidate"]>();
    const ruleList = vi.fn<ProjectData["permission"]["list"]>(
      (projectID) => rules()[projectID] ?? [],
    );
    const ruleSync = vi.fn<ProjectData["permission"]["sync"]>(
      options.ruleSync ?? (() => Promise.resolve()),
    );
    const ruleInvalidate = vi.fn<ProjectData["permission"]["invalidate"]>();
    const remove = vi.fn<SavedRemove>(
      options.remove ??
        (async ({ id }) => {
          setRulesState((current) =>
            Object.fromEntries(
              Object.entries(current).map(([projectID, projectRules]) => [
                projectID,
                projectRules?.filter((candidate) => candidate.id !== id),
              ]),
            ),
          );
        }),
    );
    const events = createOpenCodeEventSource();
    const permissions = createPermissions({
      effects,
      api: {
        debug: { location: { list: locationList } },
        permission: { request: { list: requestList }, saved: { remove } },
      },
      data: {
        on: events.on,
        session: {
          permission: {
            list: sessionList,
            sync: sessionSync,
            invalidate: sessionInvalidate,
            reply,
          },
        },
        project: {
          list: () => [...projects()],
          sync: projectSync,
          invalidate: projectInvalidate,
          permission: { list: ruleList, sync: ruleSync, invalidate: ruleInvalidate },
        },
      },
      selectedID,
      connected,
      defaultLocation,
      sessions,
      catalogState,
    });

    return {
      effects,
      dispose,
      permissions,
      locationList,
      requestList,
      sessionSync,
      sessionInvalidate,
      reply,
      projectSync,
      projectInvalidate,
      ruleSync,
      ruleInvalidate,
      remove,
      setSelectedID,
      setConnected,
      setCatalogState,
      setSessions,
      setProjects,
      setListed(sessionID: string, requests: PermissionRequest[]) {
        setListedState((current) => ({ ...current, [sessionID]: requests }));
      },
      setRules(projectID: string, next: PermissionSavedInfo[]) {
        setRulesState((current) => ({ ...current, [projectID]: next }));
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

  it("discovers unique directory/workspace locations and projects only SDK caches", async () => {
    const locationA = { directory: "/srv/a", workspaceID: "one" };
    const locationB = { directory: "/srv/a", workspaceID: "two" };
    const sessionA = session("a", locationA);
    const sessionB = session("b", locationB);
    const requestA = permission("request-a", "a");
    const requestB = permission("request-b", "b");
    const fixture = setup({
      catalogState: "ready",
      sessions: [sessionA, session("a-copy", locationA), sessionB],
      locations: new Map([
        [locationKey(locationA), [requestA]],
        [locationKey(locationB), [requestB]],
      ]),
      listed: { a: [requestA], b: [requestB] },
    });

    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.requestList).toHaveBeenCalledTimes(3);
    expect(fixture.requestList.mock.calls.map(([input]) => input?.location)).toEqual(
      expect.arrayContaining([
        { directory: "/srv/default", workspace: undefined },
        { directory: "/srv/a", workspace: "one" },
        { directory: "/srv/a", workspace: "two" },
      ]),
    );
    expect(fixture.sessionSync).toHaveBeenCalledWith("a");
    expect(fixture.sessionSync).toHaveBeenCalledWith("b");
    expect(fixture.permissions.inbox.entries()).toEqual([
      { session: sessionA, requests: [requestA] },
      { session: sessionB, requests: [requestB] },
    ]);

    fixture.setListed("a", []);
    expect(fixture.permissions.inbox.entries()).toEqual([
      { session: sessionB, requests: [requestB] },
    ]);
    fixture.dispose();
  });

  it("discovers cold permission requests at a loaded idle-session location", async () => {
    const idleLocation = { directory: "/srv/idle", workspaceID: "workspace-idle" };
    const idleRequest = permission("cold", "idle");
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("idle", idleLocation)],
      loadedLocations: [idleLocation],
      locations: new Map([[locationKey(idleLocation), [idleRequest]]]),
    });

    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.requestList).toHaveBeenCalledWith(
      { location: { directory: idleLocation.directory, workspace: idleLocation.workspaceID } },
      expect.anything(),
    );
    expect(fixture.sessionSync).toHaveBeenCalledWith("idle");
    fixture.dispose();
  });

  it("does not query unloaded historical catalog locations", async () => {
    const loaded = { directory: "/srv/loaded" };
    const missing = { directory: "/srv/historical-missing" };
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("loaded", loaded), session("missing", missing)],
      loadedLocations: [loaded],
    });

    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    const queried = fixture.requestList.mock.calls.map(([input]) => input?.location?.directory);
    expect(queried).toContain(defaultLocation.directory);
    expect(queried).toContain(loaded.directory);
    expect(queried).not.toContain(missing.directory);
    fixture.dispose();
  });

  it("hides and stops hydrating cached rows after their location unloads", async () => {
    const historical = { directory: "/srv/historical" };
    const cached = permission("cached", "historical");
    let loaded: readonly LocationRef[] = [historical];
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("historical", historical)],
      listed: { historical: [cached] },
      locationList: async () => [...loaded],
    });
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.permissions.inbox.entries()).toHaveLength(1);
    fixture.sessionSync.mockClear();

    loaded = [];
    await fixture.permissions.inbox.sync();
    expect(fixture.permissions.inbox.state()).toBe("ready");
    expect(fixture.permissions.inbox.entries()).toEqual([]);
    expect(fixture.sessionSync).not.toHaveBeenCalledWith("historical");
    fixture.dispose();
  });

  it("preserves cached rows when loaded-location inventory fails and recovers on retry", async () => {
    const active = { directory: "/srv/active" };
    const cached = permission("cached", "active");
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("active", active)],
      listed: { active: [cached] },
      locationList: vi
        .fn<LocationList>()
        .mockRejectedValueOnce(new Error("inventory unavailable"))
        .mockResolvedValue([active]),
    });

    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("failed"));
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([cached]);
    await fixture.permissions.inbox.sync();
    expect(fixture.permissions.inbox.state()).toBe("ready");
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([cached]);
    fixture.dispose();
  });

  it("hydrates and reveals an Asked location while its newer inventory fails", async () => {
    const eventLocation = { directory: "/srv/event" };
    const eventRequest = permission("event", "event-session");
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("event-session", eventLocation)],
      hydrated: { "event-session": [eventRequest] },
      locationList: vi
        .fn<LocationList>()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("inventory unavailable")),
    });
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.permissions.inbox.entries()).toEqual([]);

    fixture.emitAsked(asked(eventRequest));
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("failed"));
    expect(fixture.sessionSync).toHaveBeenCalledWith("event-session");
    expect(fixture.permissions.inbox.entries()).toEqual([
      { session: session("event-session", eventLocation), requests: [eventRequest] },
    ]);
    fixture.dispose();
  });

  it("keeps unrelated cached rows visible when initial and Asked inventories fail", async () => {
    const cachedLocation = { directory: "/srv/cached" };
    const eventLocation = { directory: "/srv/event" };
    const cachedRequest = permission("cached", "cached-session");
    const eventRequest = permission("event", "event-session");
    const fixture = setup({
      catalogState: "ready",
      sessions: [
        session("cached-session", cachedLocation),
        session("event-session", eventLocation),
      ],
      listed: { "cached-session": [cachedRequest] },
      hydrated: { "event-session": [eventRequest] },
      locationList: vi.fn<LocationList>().mockRejectedValue(new Error("inventory unavailable")),
    });
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("failed"));
    expect(fixture.permissions.inbox.entries()).toEqual([
      { session: session("cached-session", cachedLocation), requests: [cachedRequest] },
    ]);

    fixture.emitAsked(asked(eventRequest));
    await vi.waitFor(() => expect(fixture.locationList).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(fixture.permissions.inbox.entries()).toEqual([
        { session: session("cached-session", cachedLocation), requests: [cachedRequest] },
        { session: session("event-session", eventLocation), requests: [eventRequest] },
      ]),
    );
    expect(fixture.permissions.inbox.state()).toBe("failed");
    fixture.dispose();
  });

  it("lets the latest Asked inventory supersede an older stale inventory", async () => {
    const eventLocation = { directory: "/srv/event" };
    const eventRequest = permission("event", "event-session");
    const staleInventory = deferred<LocationRef[]>();
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("event-session", eventLocation)],
      hydrated: { "event-session": [eventRequest] },
      locations: new Map([[locationKey(eventLocation), [eventRequest]]]),
      locationList: vi
        .fn<LocationList>()
        .mockReturnValueOnce(staleInventory.promise)
        .mockResolvedValueOnce([eventLocation]),
    });
    await vi.waitFor(() => expect(fixture.locationList).toHaveBeenCalledOnce());

    fixture.emitAsked(asked(eventRequest));
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([eventRequest]);
    staleInventory.reject(new Error("obsolete inventory"));
    await Promise.resolve();
    expect(fixture.permissions.inbox.state()).toBe("ready");
    fixture.dispose();
  });

  it("keeps a loaded-location request failure incomplete and retryable", async () => {
    const active = { directory: "/srv/active" };
    const cached = permission("cached", "active");
    const fixture = setup({
      catalogState: "ready",
      sessions: [session("active", active)],
      listed: { active: [cached] },
      loadedLocations: [active],
      requestList: vi
        .fn<RequestList>()
        .mockResolvedValueOnce({
          location: {
            ...defaultLocation,
            project: {
              id: "project",
              directory: defaultLocation.directory,
              canonical: defaultLocation.directory,
            },
          },
          data: [],
        })
        .mockRejectedValueOnce(new Error("loaded location unavailable"))
        .mockResolvedValue({
          location: {
            ...active,
            project: { id: "project", directory: active.directory, canonical: active.directory },
          },
          data: [cached],
        }),
    });

    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("failed"));
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([cached]);
    await fixture.permissions.inbox.sync();
    expect(fixture.permissions.inbox.state()).toBe("ready");
    fixture.dispose();
  });

  it("keeps cached inbox rows on partial failure and never reports catalog failure as empty ready", async () => {
    const cached = permission("cached", "one");
    const fixture = setup({
      catalogState: "failed",
      sessions: [session("one")],
      listed: { one: [cached] },
    });
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("failed"));
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([cached]);
    expect(fixture.permissions.inbox.error()).toContain("sessions");

    fixture.setCatalogState("ready");
    fixture.requestList.mockRejectedValueOnce(new Error("one location failed"));
    await fixture.permissions.inbox.sync();
    expect(fixture.permissions.inbox.state()).toBe("failed");
    expect(fixture.permissions.inbox.entries()[0]?.requests).toEqual([cached]);
    fixture.dispose();
  });

  it("prunes formerly discovered sessions removed from the catalog", async () => {
    const oldRequest = permission("old", "old");
    const oldSession = session("old");
    const locations = new Map([[locationKey(defaultLocation), [oldRequest]]]);
    const fixture = setup({
      catalogState: "ready",
      sessions: [oldSession],
      locations,
      listed: { old: [oldRequest] },
    });
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.permissions.inbox.entries()).toHaveLength(1);
    fixture.sessionSync.mockClear();
    locations.set(locationKey(defaultLocation), []);
    fixture.setSessions([]);
    await vi.waitFor(() => expect(fixture.permissions.inbox.entries()).toEqual([]));
    await vi.waitFor(() => expect(fixture.permissions.inbox.state()).toBe("ready"));
    expect(fixture.sessionSync).not.toHaveBeenCalledWith("old");
    fixture.dispose();
  });

  it("syncs every project's saved cache and preserves cached rules on a partial failure", async () => {
    const one = project("one");
    const two = project("two");
    const firstRule = rule("first", one.id);
    const secondRule = rule("second", two.id);
    const fixture = setup({
      projects: [one, two],
      rules: { one: [firstRule], two: [secondRule] },
      ruleSync: async (projectID) => {
        if (projectID === "two") throw new Error("offline");
      },
    });

    await fixture.permissions.saved.sync();
    expect(fixture.projectInvalidate).toHaveBeenCalledOnce();
    expect(fixture.projectSync).toHaveBeenCalledOnce();
    expect(fixture.ruleSync).toHaveBeenCalledWith("one");
    expect(fixture.ruleSync).toHaveBeenCalledWith("two");
    expect(fixture.permissions.saved.state()).toBe("failed");
    expect(fixture.permissions.saved.rules()).toEqual([firstRule, secondRule]);
    fixture.dispose();
  });

  it("revokes by raw API and reports a present rule after reconciliation", async () => {
    const savedProject = project("one");
    const savedRule = rule("saved", savedProject.id);
    const fixture = setup({
      projects: [savedProject],
      rules: { one: [savedRule] },
      remove: async () => undefined,
    });
    await fixture.permissions.saved.sync();

    await fixture.permissions.saved.remove(savedRule.id);
    expect(fixture.remove).toHaveBeenCalledWith({ id: savedRule.id }, expect.anything());
    expect(fixture.ruleInvalidate).toHaveBeenCalledWith(savedProject.id);
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.saved.errorFor(savedRule.id)).toBe(
      "The saved approval could not be revoked. Try again.",
    );
    fixture.dispose();
  });

  it("keeps ambiguous revocation blocked until any public refresh recovers its project", async () => {
    const savedProject = project("one");
    const savedRule = rule("saved", savedProject.id);
    let reconciles = 0;
    let available = false;
    const fixture = setup({
      selectedID: "session",
      sessions: [session("session", defaultLocation, savedProject.id)],
      projects: [savedProject],
      rules: { one: [savedRule] },
      remove: async () => {
        throw new Error("response lost");
      },
      ruleSync: async () => {
        reconciles += 1;
        if (reconciles > 1 && !available) throw new Error("offline");
      },
    });
    await fixture.permissions.saved.sync();
    await fixture.permissions.saved.remove(savedRule.id);
    expect(fixture.permissions.pending()).toBe(true);
    expect(fixture.permissions.recoveryError()).toContain("saved approval");

    const pendingRequest = permission("blocked-by-revoke", "session");
    fixture.setListed("session", [pendingRequest]);
    await fixture.permissions.reply(pendingRequest.id, "once");
    expect(fixture.reply).not.toHaveBeenCalled();

    available = true;
    await fixture.permissions.sync();
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.saved.errorFor(savedRule.id)).toContain("could not be revoked");
    expect(fixture.sessionSync).toHaveBeenCalledWith("session");
    fixture.dispose();
  });

  it("recovers a blocked current-session reply before a saved refresh and restores cards", async () => {
    const request = permission("request", "one");
    let sessionReads = 0;
    let available = false;
    const fixture = setup({
      selectedID: "one",
      sessions: [session("one")],
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
    await fixture.permissions.saved.sync();
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

  it("refreshes the saved project after Always without blocking a settled reply on failure", async () => {
    const savedProject = project("one");
    const request = permission("always", "one", ["/tmp/**"]);
    let projectReads = 0;
    const fixture = setup({
      selectedID: "one",
      sessions: [session("one", defaultLocation, savedProject.id)],
      projects: [savedProject],
      listed: { one: [request] },
      ruleSync: async () => {
        projectReads += 1;
        throw new Error("stale");
      },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));

    await fixture.permissions.reply(request.id, "always");
    expect(projectReads).toBe(1);
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.recoveryError()).toBeUndefined();
    expect(fixture.permissions.saved.state()).toBe("failed");
    expect(fixture.permissions.saved.error()).toContain("out of date");
    fixture.dispose();
  });

  it("releases the shared lock before the ancillary saved refresh settles", async () => {
    const savedProject = project("one");
    const first = permission("always", "one", ["/tmp/**"]);
    const second = permission("once", "one");
    const savedRefresh = deferred();
    const fixture = setup({
      selectedID: "one",
      sessions: [session("one", defaultLocation, savedProject.id)],
      projects: [savedProject],
      listed: { one: [first, second] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.saved.sync();
    fixture.ruleSync.mockReturnValueOnce(savedRefresh.promise);

    const firstReply = fixture.permissions.reply(first.id, "always");
    await vi.waitFor(() => expect(fixture.ruleSync).toHaveBeenCalledTimes(2));
    expect(fixture.permissions.pending()).toBe(false);
    expect(fixture.permissions.saved.state()).toBe("loading");
    await fixture.permissions.reply(second.id, "once");
    expect(fixture.reply).toHaveBeenCalledTimes(2);

    savedRefresh.resolve();
    await firstReply;
    expect(fixture.permissions.saved.state()).toBe("ready");
    fixture.dispose();
  });

  it("does not let an own Always refresh erase a newer external stale signal", async () => {
    const projectA = project("a");
    const projectB = project("b");
    const own = permission("own", "session-a", ["/tmp/**"]);
    const external = permission("external", "session-b", ["/srv/b/**"]);
    const response = deferred();
    const fixture = setup({
      selectedID: "session-a",
      sessions: [
        session("session-a", defaultLocation, projectA.id),
        session("session-b", defaultLocation, projectB.id),
      ],
      projects: [projectA, projectB],
      listed: { "session-a": [own] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.saved.sync();
    fixture.reply.mockImplementationOnce((input) =>
      response.promise.then(() => fixture.setListed(input.sessionID, [])),
    );

    const ownReply = fixture.permissions.reply(own.id, "always");
    fixture.emitReplied(replied(external, "always"));
    expect(fixture.permissions.saved.state()).toBe("failed");
    response.resolve();
    await ownReply;

    expect(fixture.ruleSync).toHaveBeenLastCalledWith(projectA.id);
    expect(fixture.permissions.saved.state()).toBe("failed");
    expect(fixture.permissions.saved.error()).toContain("out of date");
    fixture.dispose();
  });

  it("treats a mismatched Always event for an in-flight Once reply as external", async () => {
    const savedProject = project("one");
    const request = permission("request", "one", ["/tmp/**"]);
    const response = deferred();
    const fixture = setup({
      selectedID: "one",
      sessions: [session("one", defaultLocation, savedProject.id)],
      projects: [savedProject],
      listed: { one: [request] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.saved.sync();
    fixture.reply.mockImplementationOnce((input) =>
      response.promise.then(() => fixture.setListed(input.sessionID, [])),
    );

    const localReply = fixture.permissions.reply(request.id, "once");
    fixture.emitReplied(replied(request, "always"));
    expect(fixture.permissions.saved.state()).toBe("failed");
    response.resolve();
    await localReply;

    expect(fixture.permissions.saved.state()).toBe("failed");
    expect(fixture.permissions.saved.error()).toContain("out of date");
    fixture.dispose();
  });

  it("restarts an in-flight full saved refresh after an own Always settles", async () => {
    const savedProject = project("one");
    const own = permission("own", "one", ["/tmp/**"]);
    const response = deferred();
    const staleProjectRead = deferred();
    const fixture = setup({
      selectedID: "one",
      sessions: [session("one", defaultLocation, savedProject.id)],
      projects: [savedProject],
      listed: { one: [own] },
    });
    await vi.waitFor(() => expect(fixture.permissions.state()).toBe("ready"));
    await fixture.permissions.saved.sync();
    fixture.reply.mockImplementationOnce((input) =>
      response.promise.then(() => fixture.setListed(input.sessionID, [])),
    );
    fixture.projectSync.mockReturnValueOnce(staleProjectRead.promise);

    const ownReply = fixture.permissions.reply(own.id, "always");
    const overlappingSync = fixture.permissions.saved.sync();
    await vi.waitFor(() => expect(fixture.projectSync).toHaveBeenCalledTimes(2));
    expect(fixture.permissions.saved.state()).toBe("loading");
    response.resolve();

    await vi.waitFor(() => expect(fixture.projectSync).toHaveBeenCalledTimes(3));
    await ownReply;
    expect(fixture.permissions.saved.state()).toBe("ready");
    staleProjectRead.resolve();
    await overlappingSync;
    expect(fixture.permissions.saved.state()).toBe("ready");
    fixture.dispose();
  });

  it("requires an authoritative saved refresh after reconnect", async () => {
    const fixture = setup({ projects: [project("one")] });
    await fixture.permissions.saved.sync();
    expect(fixture.permissions.saved.state()).toBe("ready");

    fixture.setConnected(false);
    await vi.waitFor(() => expect(fixture.permissions.saved.state()).toBe("failed"));
    expect(fixture.permissions.saved.error()).toContain("out of date");
    fixture.setConnected(true);
    expect(fixture.permissions.saved.state()).toBe("failed");
    await fixture.permissions.saved.sync();
    expect(fixture.permissions.saved.state()).toBe("ready");
    fixture.dispose();
  });

  it("invalidates saved caches on external replies", async () => {
    const savedProject = project("one");
    const request = permission("request", "one");
    const fixture = setup({
      sessions: [session("one", defaultLocation, savedProject.id)],
      projects: [savedProject],
    });
    await fixture.permissions.saved.sync();
    fixture.emitAsked(asked(request));
    expect(fixture.sessionInvalidate).toHaveBeenCalledWith("one");
    fixture.emitReplied(replied(request, "once"));
    expect(fixture.permissions.saved.state()).toBe("ready");
    fixture.emitReplied(replied(request, "always"));
    expect(fixture.ruleInvalidate).toHaveBeenCalledWith(savedProject.id);
    expect(fixture.permissions.saved.state()).toBe("failed");
    expect(fixture.permissions.saved.error()).toContain("out of date");
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
