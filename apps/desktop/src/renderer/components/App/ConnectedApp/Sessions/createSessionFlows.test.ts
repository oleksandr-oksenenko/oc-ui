import type { SessionInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createSessionFlows,
  type SessionFlowsRuntime,
  type SessionFlowsWorkspace,
} from "./createSessionFlows.ts";

const session = (id: string, parentID?: string): SessionInfo => ({
  id,
  parentID,
  title: id,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/srv/worktree" },
});

function setup() {
  const [streamStatus, setStreamStatus] = createSignal<"connected" | "reconnecting">("connected");
  const records = [session("root"), session("child", "root")];
  const status = new Map<string, "idle" | "running">(records.map((item) => [item.id, "idle"]));
  const remove = vi.fn<SessionFlowsWorkspace["remove"]>();
  const workspace: SessionFlowsWorkspace = {
    sessions: () => records,
    remove,
  };
  const runtime: SessionFlowsRuntime = {
    data: {
      session: { status: (id: string) => status.get(id) ?? "idle" },
      project: { list: () => [{ id: "project", sandboxes: ["/srv/worktree/"] }] },
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
  };
}

describe("createSessionFlows", () => {
  it("prunes expanded sessions when deleting a subtree", () => {
    const fixture = setup();
    const clearDraft = vi.fn<(sessionID: string) => void>();
    let flows!: ReturnType<typeof createSessionFlows>;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      flows = createSessionFlows({
        runtime: fixture.runtime,
        connected: fixture.connected,
        workspace: fixture.workspace,
        clearDraft,
      });
    });

    flows.toggleExpanded("root");
    flows.toggleExpanded("child");
    flows.deleteSessions(["root", "child"]);

    expect(flows.expandedIDs()).toEqual([]);
    expect(fixture.remove).toHaveBeenCalledWith(["root", "child"]);
    expect(clearDraft.mock.calls).toEqual([["root"], ["child"]]);
    dispose();
  });

  it("rejects running deletion and keeps the server-provided worktree path", () => {
    const fixture = setup();
    fixture.status.set("child", "running");
    let flows!: ReturnType<typeof createSessionFlows>;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      flows = createSessionFlows({
        runtime: fixture.runtime,
        connected: fixture.connected,
        workspace: fixture.workspace,
        clearDraft: vi.fn<(sessionID: string) => void>(),
      });
    });
    const opener = document.createElement("button");
    document.body.append(opener);

    expect(flows.deletionStatusForSession("root")).toBe("running");
    flows.openSessionDeletion("root", opener);
    expect(flows.deletion()).toBeUndefined();
    fixture.status.set("child", "idle");
    expect(flows.deletionStatusForSession("root")).toBe("ready");
    expect(flows.deletionStatusForSession("missing")).toBe("removed");
    flows.openSessionDeletion("root", opener);
    expect(flows.deletion()?.worktree).toEqual({
      projectID: "project",
      directory: "/srv/worktree/",
    });
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
      let flows!: ReturnType<typeof createSessionFlows>;
      let dispose!: () => void;
      createRoot((rootDispose) => {
        dispose = rootDispose;
        flows = createSessionFlows({
          runtime: fixture.runtime,
          connected: fixture.connected,
          workspace: fixture.workspace,
          clearDraft: vi.fn<(sessionID: string) => void>(),
        });
      });
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
  ])("restores focus to the fallback after %s removes the opener", (_scenario, deleteFirst) => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      let flows!: ReturnType<typeof createSessionFlows>;
      let dispose!: () => void;
      createRoot((rootDispose) => {
        dispose = rootDispose;
        flows = createSessionFlows({
          runtime: fixture.runtime,
          connected: fixture.connected,
          workspace: fixture.workspace,
          clearDraft: vi.fn<(sessionID: string) => void>(),
        });
      });
      const opener = document.createElement("button");
      const fallback = document.createElement("button");
      const resolveFallback = vi.fn<() => HTMLElement | undefined>(() => fallback);
      document.body.append(opener, fallback);

      flows.openSessionDeletion("root", opener, resolveFallback);
      if (deleteFirst) flows.deleteSessions(["root"]);
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
  });

  it("restores focus to a connected deletion opener after deletion", () => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      let flows!: ReturnType<typeof createSessionFlows>;
      let dispose!: () => void;
      createRoot((rootDispose) => {
        dispose = rootDispose;
        flows = createSessionFlows({
          runtime: fixture.runtime,
          connected: fixture.connected,
          workspace: fixture.workspace,
          clearDraft: vi.fn<(sessionID: string) => void>(),
        });
      });
      const opener = document.createElement("button");
      const fallback = document.createElement("button");
      const resolveFallback = vi.fn<() => HTMLElement | undefined>(() => fallback);
      document.body.append(opener, fallback);

      flows.openSessionDeletion("root", opener, resolveFallback);
      flows.deleteSessions(["root"]);
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
