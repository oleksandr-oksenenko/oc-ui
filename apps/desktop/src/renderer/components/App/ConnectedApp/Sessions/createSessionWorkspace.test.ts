import type { SessionInfo, SessionMessageInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

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
    syncTranscript: vi.fn<SessionWorkspaceRuntime["syncTranscript"]>(async () => undefined),
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
  return createRoot((dispose) => ({
    workspace: createSessionWorkspace({
      runtime: fixture.runtime,
      connected: fixture.connected,
      bootstrapped: fixture.bootstrapped,
    }),
    dispose,
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
    expect(fixture.runtime.api.session.interrupt).toHaveBeenCalledWith({ sessionID: "one" });
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
    expect(fixture.runtime.syncTranscript).toHaveBeenCalledTimes(2);
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
});
