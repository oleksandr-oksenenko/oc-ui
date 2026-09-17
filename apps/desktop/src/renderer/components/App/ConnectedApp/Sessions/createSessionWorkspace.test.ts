import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { createSessionWorkspace, type SessionWorkspaceRuntime } from "./createSessionWorkspace.ts";

const session = (id: string, updated: number, parentID?: string): SessionInfo =>
  sessionFixture({
    id,
    parentID,
    title: id,
    time: { created: updated, updated },
    location: { directory: "/project" },
  });

const bootstrapped = () => true;

function setup(initial: readonly SessionInfo[]) {
  const mutableRecords: SessionInfo[] = [...initial];
  const [ids, setIDs] = createSignal(initial.map((item) => item.id));
  const [catalogState, setCatalogState] = createSignal<"loading" | "ready" | "failed">("ready");
  const [connected, setConnected] = createSignal(true);
  const statuses = new Map<string, "idle" | "running">();
  const messages = new Map<string, SessionMessageInfo[]>();
  const runtime: SessionWorkspaceRuntime = {
    api: {
      session: {
        active: vi.fn<SessionWorkspaceRuntime["api"]["session"]["active"]>(async () => ({})),
        interrupt: vi.fn<SessionWorkspaceRuntime["api"]["session"]["interrupt"]>(async () => ({
          interrupted: true,
        })),
      },
    },
    data: {
      session: {
        list: () => mutableRecords,
        status: (id: string) => statuses.get(id) ?? "idle",
        setStatus: (id: string, status: "idle" | "running") => statuses.set(id, status),
        message: { list: (id: string) => messages.get(id) ?? [] },
      },
    },
    sessions: {
      ids,
      state: catalogState,
      sync: vi.fn<SessionWorkspaceRuntime["sessions"]["sync"]>(async () => undefined),
      remove: (id: string) => setIDs((current) => current.filter((item) => item !== id)),
    },
    loader: { load: vi.fn<SessionWorkspaceRuntime["loader"]["load"]>(() => Effect.void) },
  };
  return {
    runtime,
    setIDs,
    setCatalogState,
    connected,
    setConnected,
    bootstrapped,
    setStatus: (id: string, status: "idle" | "running") => statuses.set(id, status),
  };
}

function mount(fixture: ReturnType<typeof setup>) {
  return withTestWorkspace((effects, dispose) => ({
    workspace: createSessionWorkspace({
      effects,
      runtime: fixture.runtime,
      connected: fixture.connected,
      bootstrapped: fixture.bootstrapped,
    }),
    dispose: () => {
      dispose();
      void Effect.runPromise(Scope.close(effects.scope, Exit.void));
    },
  }));
}

describe("createSessionWorkspace", () => {
  it("interrupts the selected running session and serializes repeated stops", async () => {
    const fixture = setup([session("one", 1)]);
    let resolveInterrupt!: () => void;
    vi.mocked(fixture.runtime.api.session.interrupt).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInterrupt = () => resolve({ interrupted: true });
        }),
    );
    const { workspace, dispose } = mount(fixture);
    fixture.setStatus("one", "running");

    const firstStop = workspace.stop();
    await workspace.stop();

    expect(fixture.runtime.api.session.interrupt).toHaveBeenCalledOnce();
    expect(fixture.runtime.api.session.interrupt).toHaveBeenCalledWith(
      { sessionID: "one" },
      { signal: expect.any(AbortSignal) },
    );
    resolveInterrupt();
    await firstStop;
    dispose();
  });

  it("reports an interrupt failure for the selected session", async () => {
    const fixture = setup([session("one", 1)]);
    vi.mocked(fixture.runtime.api.session.interrupt).mockRejectedValue(new Error("offline"));
    const { workspace, dispose } = mount(fixture);
    fixture.setStatus("one", "running");

    await workspace.stop();

    expect(workspace.stopError()).toBe("The session could not be stopped. Try again.");
    dispose();
  });

  it("sorts catalog-admitted sessions by update time and id", () => {
    const fixture = setup([session("z", 1), session("b", 4), session("a", 4)]);
    const { workspace, dispose } = mount(fixture);

    expect(workspace.sessions().map((item) => item.id)).toEqual(["a", "b", "z"]);
    dispose();
  });

  it("ignores disconnected and unchanged selections", async () => {
    const fixture = setup([session("one", 1), session("two", 2)]);
    const { workspace, dispose } = mount(fixture);

    expect(workspace.selectedID()).toBe("two");
    fixture.setConnected(false);
    workspace.select("one");
    expect(workspace.selectedID()).toBe("two");
    fixture.setConnected(true);
    workspace.select("one");
    workspace.select("one");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("one"));
    expect(fixture.runtime.loader.load).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("falls back to an ancestor and clears when the catalog empties", async () => {
    const root = session("root", 1);
    const child = session("child", 2, "root");
    const fixture = setup([root, child]);
    const { workspace, dispose } = mount(fixture);

    workspace.select("child");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("child"));
    fixture.setIDs(["root"]);
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("root"));
    fixture.setIDs([]);
    await vi.waitFor(() => expect(workspace.selectedID()).toBeUndefined());
    expect(workspace.transcriptStatus()).toBe("idle");
    dispose();
  });

  it("preserves recovery failure for the session that remains selected", () => {
    const fixture = setup([session("one", 1), session("two", 2)]);
    const { workspace, dispose } = mount(fixture);

    workspace.select("two");
    workspace.beginRecovery();
    workspace.failRecovery();
    expect(workspace.transcriptError()).toBe(
      "The session could not be refreshed after reconnecting.",
    );
    dispose();
  });

  it("does not fail a newly selected session after recovery begins", () => {
    const fixture = setup([session("one", 1), session("two", 2)]);
    const { workspace, dispose } = mount(fixture);

    workspace.select("two");
    workspace.beginRecovery();
    workspace.select("one");
    workspace.failRecovery();
    expect(workspace.transcriptError()).toBeUndefined();
    dispose();
  });

  it("does not fail a session when recovery started without a selection", () => {
    const fixture = setup([]);
    const { workspace, dispose } = mount(fixture);

    workspace.beginRecovery();
    workspace.failRecovery();

    expect(workspace.selectedID()).toBeUndefined();
    expect(workspace.transcriptError()).toBeUndefined();
    dispose();
  });
  it("interrupts obsolete hydration without overwriting the replacement result", async () => {
    const fixture = setup([session("one", 1)]);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.transcriptLoading()).toBe(false));
    const first = deferred();
    const second = deferred();
    vi.mocked(fixture.runtime.loader.load)
      .mockReturnValueOnce(Effect.promise(() => first.promise))
      .mockReturnValueOnce(Effect.promise(() => second.promise));

    const obsolete = workspace.hydrate("one");
    const replacement = workspace.hydrate("one");
    await vi.waitFor(() => expect(fixture.runtime.loader.load).toHaveBeenCalledTimes(3));

    first.resolve();
    await obsolete;
    expect(workspace.transcriptError()).toBeUndefined();
    expect(workspace.transcriptLoading()).toBe(true);

    second.resolve();
    await replacement;
    expect(workspace.transcriptLoading()).toBe(false);
    dispose();
  });

  it("refreshes the catalog before retrying the selected child transcript", async () => {
    const fixture = setup([session("root", 1), session("child", 2, "root")]);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.transcriptLoading()).toBe(false));
    const order: string[] = [];
    vi.mocked(fixture.runtime.sessions.sync).mockImplementation(async () => {
      order.push("catalog");
    });
    vi.mocked(fixture.runtime.loader.load).mockImplementation((id) =>
      Effect.sync(() => {
        order.push(id);
      }),
    );
    await workspace.retryCatalog();
    expect(order).toEqual(["catalog", "child"]);
    dispose();
  });

  it("settles a disposed hydration wait while transcript work retains its owner", async () => {
    const fixture = setup([session("one", 1)]);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.transcriptLoading()).toBe(false));
    const request = deferred();
    vi.mocked(fixture.runtime.loader.load).mockReturnValueOnce(
      Effect.promise(() => request.promise),
    );
    let settled = false;
    const pending = workspace.hydrate("one").then(() => {
      settled = true;
      return undefined;
    });
    dispose();
    await vi.waitFor(() => expect(settled).toBe(true));
    await pending;
    request.resolve();
  });
});
