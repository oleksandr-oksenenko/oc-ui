import type { OpenCodeEvent } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createSessionAttention } from "./createSessionAttention.ts";

type Input = Parameters<typeof createSessionAttention>[0];
function setup(unloaded = false) {
  return withTestWorkspace((effects, dispose) => {
    const events = createOpenCodeEventSource();
    const [selectedID, select] = createSignal<string | undefined>("viewed");
    const [permissions, setPermissions] = createSignal<
      ReturnType<Input["data"]["session"]["permission"]["list"]>
    >(unloaded ? undefined : []);
    const [forms, setForms] = createSignal<ReturnType<Input["data"]["session"]["form"]["list"]>>(
      unloaded ? undefined : [],
    );
    const [connected, setConnected] = createSignal(true);
    const sync = vi.fn<Input["data"]["session"]["form"]["sync"]>(() => Promise.resolve());
    const invalidate = vi.fn<Input["data"]["session"]["form"]["invalidate"]>();
    const permissionSync = vi.fn<Input["data"]["session"]["permission"]["sync"]>(() =>
      Promise.resolve(),
    );
    const permissionInvalidate = vi.fn<Input["data"]["session"]["permission"]["invalidate"]>();
    const attention = createSessionAttention({
      sessionIDs: () => ["viewed", "background", "dormant"],
      listLocations: () => Promise.resolve([{ directory: "/project" }]),
      connected,
      effects,
      selectedID,
      data: {
        on: events.on,
        session: {
          get: (id) =>
            sessionFixture({
              id,
              location: { directory: id === "dormant" ? "/dormant" : "/project" },
            }),
          permission: { list: permissions, sync: permissionSync, invalidate: permissionInvalidate },
          form: { list: forms, sync, invalidate },
        },
      },
    });
    return {
      sync,
      permissionSync,
      permissionInvalidate,
      invalidate,
      setConnected,
      attention,
      select,
      setPermissions,
      setForms,
      emit: events.emit,
      dispose,
    };
  });
}
function completed(
  sessionID: string,
): Extract<OpenCodeEvent, { type: "session.execution.succeeded" }> {
  return {
    type: "session.execution.succeeded",
    id: `finished-${sessionID}`,
    created: 1,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID },
  };
}

describe("session attention", () => {
  it("marks finished background turns and clears them on opening, without marking the viewed session", () => {
    const state = setup();
    expect(state.attention("background")).toBeUndefined();
    state.emit(completed("background"));
    state.emit(completed("viewed"));
    expect(state.attention("background")).toBe("completed");
    expect(state.attention("viewed")).toBeUndefined();
    state.select("background");
    expect(state.attention("background")).toBeUndefined();
    state.select("viewed");
    expect(state.attention("background")).toBeUndefined();
  });

  it("keeps questions and permissions until resolved, including in the selected session", () => {
    const state = setup();
    state.setForms([
      {
        id: "question",
        sessionID: "viewed",
        title: "Choose",
        fields: [{ type: "string", key: "answer", title: "Answer", required: true }],
      },
    ]);
    expect(state.attention("viewed")).toBe("question");
    state.setPermissions([
      { id: "permission", sessionID: "viewed", action: "read", resources: [], metadata: {} },
    ]);
    expect(state.attention("viewed")).toBe("permission");
    state.setPermissions([]);
    expect(state.attention("viewed")).toBe("question");
    state.setForms([]);
    expect(state.attention("viewed")).toBeUndefined();
  });

  it("loads questions and permissions for unopened sessions and refreshes cached lists after reconnect", async () => {
    const state = setup(true);
    await expect.poll(() => state.sync.mock.calls.length).toBe(2);
    expect(state.sync).toHaveBeenCalledWith("background");
    expect(state.sync).not.toHaveBeenCalledWith("dormant");
    expect(state.permissionSync).toHaveBeenCalledWith("background");
    expect(state.permissionSync).not.toHaveBeenCalledWith("dormant");
    state.setForms([]);
    state.setPermissions([]);
    state.setConnected(false);
    state.setConnected(true);
    await expect.poll(() => state.sync.mock.calls.length).toBe(4);
    expect(state.invalidate).toHaveBeenCalledWith("background");
    await expect.poll(() => state.permissionSync.mock.calls.length).toBe(4);
    expect(state.permissionInvalidate).toHaveBeenCalledWith("background");
  });

  it("clears old completion markers when another execution starts or the session is deleted", () => {
    const state = setup();
    state.emit(completed("background"));
    state.emit({ ...completed("background"), type: "session.execution.started" });
    expect(state.attention("background")).toBeUndefined();
    state.emit(completed("background"));
    state.emit({
      ...completed("background"),
      id: "deleted",
      created: 2,
      type: "session.deleted",
      durable: { aggregateID: "background", seq: 2, version: 2 },
      data: { sessionID: "background" },
    });
    expect(state.attention("background")).toBeUndefined();
  });

  it("stops listening when the workspace is disposed", () => {
    const state = setup();
    state.dispose();
    state.emit(completed("background"));
    expect(state.attention("background")).toBeUndefined();
  });
});
