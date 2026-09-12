import { OpenCode, type SessionInfo } from "@opencode-ai/client";
import { createData } from "@opencode-ai/client/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../../../../test/workspace.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import {
  createSessionFlows,
  type SessionFlowsRuntime,
  type SessionFlowsWorkspace,
} from "./createSessionFlows.ts";

const session = (id: string, parentID?: string): SessionInfo =>
  sessionFixture({
    id,
    parentID,
    title: id,
    location: { directory: "/srv/worktree" },
  });

function setup() {
  const [streamStatus, setStreamStatus] = createSignal<"connected" | "reconnecting">("connected");
  const records = [session("root"), session("child", "root")];
  const status = new Map<string, "idle" | "running">(records.map((item) => [item.id, "idle"]));
  const remove = vi.fn<SessionFlowsWorkspace["remove"]>();
  const syncCatalog = vi.fn<SessionFlowsWorkspace["syncCatalog"]>().mockResolvedValue(undefined);
  const workspace: SessionFlowsWorkspace = {
    sessions: () => records,
    syncCatalog,
    remove,
  };
  const api = OpenCode.make({ baseUrl: "http://session-flows.test" });
  vi.spyOn(api.session, "remove").mockResolvedValue(undefined);
  vi.spyOn(api.worktree, "list").mockResolvedValue([]);
  const { effects: workspaceEffects, data } = withTestWorkspace((effects) => ({
    effects,
    data: createData({
      api: () => api,
      directory: "/srv/worktree",
      event: {
        on: () => () => undefined,
        listen: () => () => undefined,
      },
    }),
  }));
  vi.spyOn(data.session, "status").mockImplementation((id) => status.get(id) ?? "idle");
  vi.spyOn(data.project, "sync").mockResolvedValue(undefined);
  const runtime: SessionFlowsRuntime = {
    effects: workspaceEffects,
    api,
    data,
    onShellExited: () => () => undefined,
    defaultLocation: { directory: "/srv/worktree" },
    sessions: {
      ids: () => records.map((item) => item.id),
      admit: () => undefined,
      remove: () => undefined,
      sync: async () => undefined,
      state: () => "ready",
      error: () => undefined,
    },
  };
  return {
    runtime,
    connected: () => streamStatus() === "connected",
    workspace,
    records,
    status,
    setStreamStatus,
    remove,
    syncCatalog,
  };
}

function mount(fixture: ReturnType<typeof setup>, clearDraft: (sessionID: string) => void) {
  return createRoot((dispose) => ({
    flows: createSessionFlows({
      runtime: fixture.runtime,
      connected: fixture.connected,
      workspace: fixture.workspace,
      clearDraft,
      onSessionCreated: () => undefined,
    }),
    dispose,
  }));
}

describe("createSessionFlows", () => {
  it("creates with the newest root session's options and retains them across a failed attempt", async () => {
    const fixture = setup();
    const model = { providerID: "provider", id: "model", variant: "high" };
    fixture.records.splice(
      0,
      fixture.records.length,
      { ...session("older"), agent: "old-agent", time: { created: 1, updated: 100 } },
      { ...session("newest"), agent: "chosen-agent", model, time: { created: 2, updated: 2 } },
      { ...session("child", "newest"), agent: "child-agent", time: { created: 3, updated: 3 } },
    );
    vi.spyOn(fixture.runtime.data.project, "list").mockReturnValue([
      {
        id: "project",
        canonical: "/srv/worktree",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      },
    ]);
    const create = vi.spyOn(fixture.runtime.api.session, "create");
    create.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(session("created"));
    vi.spyOn(fixture.runtime.data.session, "sync").mockResolvedValue(undefined);
    const { flows, dispose } = mount(fixture, vi.fn());
    flows.openNewSession();
    await vi.waitFor(() => expect(flows.newSession()?.state().projectsLoading).toBe(false));
    const flow = flows.newSession()!;
    flow.useProject("project");
    await vi.waitFor(() => expect(flow.state().error?.kind).toBe("session"));
    fixture.records.push({
      ...session("later"),
      agent: "later-agent",
      time: { created: 4, updated: 4 },
    });
    flow.retry();
    await vi.waitFor(() => expect(flows.newSession()).toBeUndefined());
    expect(create).toHaveBeenCalledTimes(2);
    for (const [input] of create.mock.calls) {
      expect(input).toMatchObject({
        agent: "chosen-agent",
        model,
        location: { directory: "/srv/worktree" },
      });
    }
    dispose();
  });

  it("releases status mounts whenever creation and deletion flows are dismissed", async () => {
    const fixture = setup();
    const registry = fixture.runtime.effects.registry;
    const mountAtom = registry.mount.bind(registry);
    let mountedAtoms = 0;
    vi.spyOn(registry, "mount").mockImplementation((atom) => {
      const release = mountAtom(atom);
      mountedAtoms += 1;
      return () => {
        mountedAtoms -= 1;
        release();
      };
    });
    const { flows, dispose } = mount(fixture, vi.fn());
    for (let index = 0; index < 5; index += 1) {
      flows.openNewSession();
      expect(mountedAtoms).toBe(1);
      flows.dismissNewSession();
      await vi.waitFor(() => expect(mountedAtoms).toBe(0));
      flows.openSessionDeletion("root", document.createElement("button"));
      expect(mountedAtoms).toBe(1);
      flows.dismissDeletion();
      await vi.waitFor(() => expect(mountedAtoms).toBe(0));
    }
    dispose();
  });

  it("prunes expanded sessions when deleting a subtree", async () => {
    const fixture = setup();
    const clearDraft = vi.fn<(sessionID: string) => void>();
    const { flows, dispose } = mount(fixture, clearDraft);

    flows.toggleExpanded("root");
    flows.toggleExpanded("child");
    flows.openSessionDeletion("root", document.createElement("button"));
    flows.deletion()?.flow.delete();
    await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalled());

    expect(flows.expandedIDs()).toEqual([]);
    expect(fixture.remove).toHaveBeenCalledWith(["root", "child"]);
    expect(clearDraft.mock.calls).toEqual([["root"], ["child"]]);
    dispose();
  });

  it("rejects running deletion and exposes the current catalog refresh", () => {
    const fixture = setup();
    fixture.status.set("child", "running");
    const { flows, dispose } = mount(fixture, vi.fn<(sessionID: string) => void>());
    const opener = document.createElement("button");
    document.body.append(opener);

    expect(flows.deletionStatusForSession("root")).toBe("running");
    flows.openSessionDeletion("root", opener);
    expect(flows.deletion()).toBeUndefined();
    fixture.status.set("child", "idle");
    expect(flows.deletionStatusForSession("root")).toBe("ready");
    expect(flows.deletionStatusForSession("missing")).toBe("removed");
    flows.openSessionDeletion("root", opener);
    expect(flows.deletion()?.flow.pending()).toBe(false);
    fixture.setStreamStatus("reconnecting");
    flows.dismissDeletion();
    flows.openSessionDeletion("root", opener);
    expect(flows.deletion()).toBeUndefined();

    opener.remove();
    dispose();
  });

  it("restores focus to the new-session opener after dismissal", () => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      const { flows, dispose } = mount(fixture, vi.fn<(sessionID: string) => void>());
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();

      flows.openNewSession();
      flows.dismissNewSession();
      vi.advanceTimersByTime(111);
      expect(document.activeElement).toBe(opener);

      opener.remove();
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["successful deletion", true],
    ["external removal", false],
  ])(
    "restores focus to the fallback after %s removes the opener",
    async (_scenario, deleteFirst) => {
      vi.useFakeTimers();
      try {
        const fixture = setup();
        const { flows, dispose } = mount(fixture, vi.fn<(sessionID: string) => void>());
        const opener = document.createElement("button");
        const fallback = document.createElement("button");
        const resolveFallback = vi.fn<() => HTMLElement | undefined>(() => fallback);
        document.body.append(opener, fallback);

        flows.openSessionDeletion("root", opener, resolveFallback);
        if (deleteFirst) {
          flows.deletion()?.flow.delete();
          await vi.waitFor(() => {
            if (fixture.remove.mock.calls.length === 0)
              throw new Error("Deletion has not completed");
          });
        }
        opener.remove();
        flows.dismissDeletion();
        vi.advanceTimersByTime(111);

        expect(resolveFallback).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(fallback);

        fallback.remove();
        dispose();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("restores focus to a connected deletion opener after deletion", async () => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      const { flows, dispose } = mount(fixture, vi.fn<(sessionID: string) => void>());
      const opener = document.createElement("button");
      const fallback = document.createElement("button");
      const resolveFallback = vi.fn<() => HTMLElement | undefined>(() => fallback);
      document.body.append(opener, fallback);

      flows.openSessionDeletion("root", opener, resolveFallback);
      flows.deletion()?.flow.delete();
      await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalled());
      flows.dismissDeletion();
      vi.advanceTimersByTime(111);

      expect(resolveFallback).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(opener);

      opener.remove();
      fallback.remove();
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
