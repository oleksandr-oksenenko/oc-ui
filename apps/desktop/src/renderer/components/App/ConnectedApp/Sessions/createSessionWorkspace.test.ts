import type { OpenCodeEvent, SessionInfo, SessionMessageInfo } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { createSessionWorkspace, type SessionWorkspaceRuntime } from "./createSessionWorkspace.ts";
import { createShellPanelState } from "../Shell/createShellPanelState.ts";
import {
  createSessionPanelLayouts,
  DEFAULT_SESSION_PANEL_LAYOUT,
} from "../Shell/sessionPanelLayouts.ts";

const session = (id: string, updated: number, parentID?: string, idle?: number): SessionInfo =>
  sessionFixture({
    id,
    parentID,
    title: id,
    time: { created: updated, updated, idle },
    location: { directory: "/project" },
  });

type SucceededEvent = Extract<OpenCodeEvent, { type: "session.execution.succeeded" }>;
type InterruptedEvent = Extract<OpenCodeEvent, { type: "session.execution.interrupted" }>;

const completed = (sessionID: string, created: number): SucceededEvent => ({
  type: "session.execution.succeeded",
  id: `completed-${sessionID}-${created}`,
  created,
  durable: { aggregateID: sessionID, seq: 1, version: 1 },
  data: { sessionID },
});

const interrupted = (
  sessionID: string,
  created: number,
  reason: InterruptedEvent["data"]["reason"],
): InterruptedEvent => ({
  type: "session.execution.interrupted",
  id: `interrupted-${sessionID}-${created}`,
  created,
  durable: { aggregateID: sessionID, seq: 1, version: 1 },
  data: { sessionID, reason },
});

const bootstrapped = () => true;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(initial: readonly SessionInfo[]) {
  const events = createOpenCodeEventSource();
  const [records, setRecords] = createSignal([...initial]);
  const [ids, setIDs] = createSignal(initial.map((item) => item.id));
  const [catalogState, setCatalogState] = createSignal<"loading" | "ready" | "failed">("ready");
  const [connected, setConnected] = createSignal(true);
  const [statuses, setStatuses] = createSignal<ReadonlyMap<string, "idle" | "running">>(new Map());
  const messages = new Map<string, SessionMessageInfo[]>();
  const setStatus = (id: string, status: "idle" | "running") =>
    setStatuses((current) => new Map(current).set(id, status));
  const runtime: SessionWorkspaceRuntime = {
    api: {
      session: {
        active: vi.fn<SessionWorkspaceRuntime["api"]["session"]["active"]>(async () => ({})),
        interrupt: vi.fn<SessionWorkspaceRuntime["api"]["session"]["interrupt"]>(async () => ({
          interrupted: true,
        })),
        view: vi.fn<SessionWorkspaceRuntime["api"]["session"]["view"]>(async () => undefined),
      },
    },
    data: {
      on: events.on,
      session: {
        list: () => records(),
        get: (id: string) => records().find((record) => record.id === id),
        status: (id: string) => statuses().get(id) ?? "idle",
        setStatus,
        message: { list: (id: string) => messages.get(id) ?? [] },
      },
    },
    sessions: {
      ids,
      state: catalogState,
      sync: vi.fn<SessionWorkspaceRuntime["sessions"]["sync"]>(async () => undefined),
      remove: (id: string) => setIDs((current) => current.filter((item) => item !== id)),
    },
    memory: { touchSelection: vi.fn<SessionWorkspaceRuntime["memory"]["touchSelection"]>() },
    loader: { load: vi.fn<SessionWorkspaceRuntime["loader"]["load"]>(() => Effect.void) },
  };
  return {
    runtime,
    setIDs,
    setCatalogState,
    connected,
    setConnected,
    bootstrapped,
    setStatus,
    emit: events.emit,
    setIdle: (id: string, idle: number) =>
      setRecords((current) =>
        current.map((record) =>
          record.id === id ? { ...record, time: { ...record.time, idle } } : record,
        ),
      ),
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

function mountWithPanels(fixture: ReturnType<typeof setup>) {
  return withTestWorkspace((effects, dispose) => {
    const layouts = createSessionPanelLayouts({ effects, storage: null });
    const workspace = createSessionWorkspace({
      effects,
      runtime: fixture.runtime,
      connected: fixture.connected,
      bootstrapped: fixture.bootstrapped,
    });
    const panels = createShellPanelState({ selectedID: workspace.selectedID, layouts });
    return {
      workspace,
      panels,
      layouts,
      dispose: () => {
        dispose();
        void Effect.runPromise(Scope.close(effects.scope, Exit.void));
      },
    };
  });
}

describe("createSessionWorkspace", () => {
  it("records every selection path in the eviction policy", async () => {
    const fixture = setup([session("one", 1), session("two", 2)]);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() =>
      expect(fixture.runtime.memory.touchSelection).toHaveBeenCalledWith("two"),
    );
    workspace.select("one");
    await vi.waitFor(() =>
      expect(fixture.runtime.memory.touchSelection).toHaveBeenCalledWith("one"),
    );
    workspace.markCreated("fresh");
    await vi.waitFor(() =>
      expect(fixture.runtime.memory.touchSelection).toHaveBeenCalledWith("fresh"),
    );
    dispose();
  });

  it("requests the transcript on each selection, including a return", async () => {
    const fixture = setup([session("one", 1), session("two", 2)]);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.transcriptLoading()).toBe(false));
    const load = vi.mocked(fixture.runtime.loader.load);
    load.mockClear();

    workspace.select("one");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("one"));
    workspace.select("two");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("two"));
    workspace.select("one");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("one"));

    // The loader owns refetching; the workspace must ask it again on every
    // selection, including a return after a family was evicted.
    expect(load.mock.calls.map((call) => call[0])).toEqual(["one", "two", "one"]);
    dispose();
  });

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

  it("reloads the selected transcript when a run ends", async () => {
    const fixture = setup([session("one", 1)]);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.transcriptLoading()).toBe(false));
    const load = vi.mocked(fixture.runtime.loader.load);
    load.mockClear();

    fixture.setStatus("one", "running");
    await vi.waitFor(() => expect(workspace.running()).toBe(true));
    fixture.setStatus("one", "idle");
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith("one"));
    dispose();
  });

  it("acknowledges the idle watermark when the selected session becomes idle", async () => {
    const fixture = setup([session("one", 1)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { workspace, dispose } = mount(fixture);
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("one"));
    expect(view).not.toHaveBeenCalled();

    fixture.setStatus("one", "running");
    await vi.waitFor(() => expect(workspace.running()).toBe(true));
    fixture.setIdle("one", 4_000);
    await flush();
    expect(view).not.toHaveBeenCalled();

    fixture.setStatus("one", "idle");
    await vi.waitFor(() => expect(workspace.running()).toBe(false));
    await vi.waitFor(() =>
      expect(view).toHaveBeenCalledWith(
        { sessionID: "one", idle: 4_000 },
        { signal: expect.any(AbortSignal) },
      ),
    );
    expect(view).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("acknowledges an already-idle session once and skips an unchanged watermark", async () => {
    const fixture = setup([
      session("one", 1, undefined, 1_000),
      session("two", 2, undefined, 2_000),
    ]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "two", idle: 2_000 },
      { signal: expect.any(AbortSignal) },
    );

    workspace.select("one");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "one", idle: 1_000 },
      { signal: expect.any(AbortSignal) },
    );

    workspace.select("two");
    await vi.waitFor(() => expect(workspace.selectedID()).toBe("two"));
    await flush();
    expect(view).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("acknowledges a newer idle watermark for the selected session", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.setIdle("one", 2_000);
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "one", idle: 2_000 },
      { signal: expect.any(AbortSignal) },
    );
    dispose();
  });

  it("acknowledges a completion from the execution event before the record syncs", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.emit(completed("one", 5_000));
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "one", idle: 5_000 },
      { signal: expect.any(AbortSignal) },
    );

    // The record catches up with the same watermark; it is not sent twice.
    fixture.setIdle("one", 5_000);
    await flush();
    expect(view).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("acknowledges a completion before the selection moves on", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000), session("two", 2, undefined, 500)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.emit(completed("two", 2_000));
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "two", idle: 2_000 },
      { signal: expect.any(AbortSignal) },
    );

    // The selection moves on before the record syncs, but the completion was
    // already acknowledged from the event and is not acknowledged again.
    workspace.select("one");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(3));
    fixture.setIdle("two", 2_000);
    await flush();
    expect(view).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("does not acknowledge completions for an unselected session", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000), session("two", 2, undefined, 500)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.emit(completed("one", 5_000));
    await flush();
    expect(view).toHaveBeenCalledTimes(1);

    // Selecting it later acknowledges the record's watermark instead.
    workspace.select("one");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "one", idle: 1_000 },
      { signal: expect.any(AbortSignal) },
    );
    dispose();
  });

  it("ignores shutdown interruptions", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.emit(interrupted("one", 5_000, "shutdown"));
    await flush();
    expect(view).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("stops acknowledging completions after disposal", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    dispose();
    fixture.emit(completed("one", 5_000));
    await flush();
    expect(view).toHaveBeenCalledTimes(1);
  });

  it("defers a record-only watermark until the session is selected again", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000), session("two", 2, undefined, 500)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "two", idle: 500 },
      { signal: expect.any(AbortSignal) },
    );

    fixture.setStatus("two", "running");
    await vi.waitFor(() => expect(workspace.running()).toBe(true));
    fixture.setStatus("two", "idle");
    await vi.waitFor(() => expect(workspace.running()).toBe(false));
    workspace.select("one");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));

    // Without a terminal event the record watermark syncs after the selection
    // moved on, so it waits for the next selection instead of acknowledging an
    // unseen state.
    fixture.setIdle("two", 2_000);
    await flush();
    expect(view).toHaveBeenCalledTimes(2);

    workspace.select("two");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(3));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "two", idle: 2_000 },
      { signal: expect.any(AbortSignal) },
    );
    dispose();
  });

  it("keeps a newer watermark when an older failed request settles", async () => {
    const fixture = setup([session("one", 1, undefined, 1_000)]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    view.mockImplementationOnce(() => first);
    const { dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    fixture.setIdle("one", 2_000);
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));

    rejectFirst(new Error("offline"));
    // The app's rejection handler settles the rollback before this resolves.
    await first.catch(() => undefined);

    // The older failure must not clear the newer watermark.
    fixture.setIdle("one", 2_000);
    await flush();
    expect(view).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("contains a failed view acknowledgement and retries on a later selection", async () => {
    const fixture = setup([
      session("one", 1, undefined, 1_000),
      session("two", 2, undefined, 2_000),
    ]);
    const view = vi.mocked(fixture.runtime.api.session.view);
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    view.mockImplementationOnce(() => first);
    const { workspace, dispose } = mount(fixture);

    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(1));
    rejectFirst(new Error("offline"));
    // The app's rejection handler settles the rollback before this resolves.
    await first.catch(() => undefined);
    expect(workspace.transcriptError()).toBeUndefined();

    workspace.select("one");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2));
    workspace.select("two");
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(3));
    expect(view).toHaveBeenLastCalledWith(
      { sessionID: "two", idle: 2_000 },
      { signal: expect.any(AbortSignal) },
    );
    dispose();
  });

  it("writes the browser-open layout to the session selected in the same update", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      const fixture = setup([session("one", 1), session("two", 2)]);
      const { workspace, panels, layouts, dispose } = mountWithPanels(fixture);
      await vi.waitFor(() => expect(workspace.selectedID()).toBe("two"));

      workspace.select("one");
      panels.setContextView("browser");
      panels.setRightPanelOpen(true);
      expect(panels.contextView()).toBe("browser");
      expect(panels.rightPanelOpen()).toBe(true);
      expect(layouts.layout("one")).toEqual({ open: true, view: "browser" });

      workspace.select("two");
      expect(panels.rightPanelOpen()).toBe(false);
      expect(panels.contextView()).toBe("diff");
      expect(layouts.layout("two")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);

      workspace.select("one");
      expect(panels.rightPanelOpen()).toBe(true);
      expect(panels.contextView()).toBe("browser");
      dispose();
    } finally {
      vi.unstubAllGlobals();
    }
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
