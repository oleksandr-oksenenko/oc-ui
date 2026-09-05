import { withTestWorkspace } from "../../../../test/workspace.ts";
import type { FormInfo, LocationRef, OpenCodeEvent } from "@opencode-ai/client";
import type { FormWithLocation } from "@opencode-ai/client/solid";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../../../../test/deferred.ts";
import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { createGlobalForms, type CreateGlobalFormsInput } from "./createGlobalForms.ts";

type FormApi = CreateGlobalFormsInput["runtime"]["data"]["session"]["form"];
type CreatedEvent = Extract<OpenCodeEvent, { type: "form.created" }>;

const location: LocationRef = {
  directory: "/srv/remote/project",
  workspaceID: "workspace-feature",
};

function form(id: string): FormInfo {
  return {
    id,
    sessionID: "global",
    title: `Request ${id}`,
    fields: [{ key: "answer", type: "string", title: "Answer" }],
  };
}

function created(
  id: string,
  eventLocation?: LocationRef,
  sessionID: string = "global",
): CreatedEvent {
  const event: CreatedEvent = {
    id: `event-${id}`,
    created: 1,
    type: "form.created",
    data: {
      form: {
        id,
        sessionID,
        title: `Request ${id}`,
        metadata: {},
        fields: [{ key: "answer", type: "string", title: "Answer", required: true }],
      },
    },
  };
  if (eventLocation === undefined) return event;
  return { ...event, location: eventLocation };
}

function setup(initialConnected = false, initialForms: FormWithLocation[] = []) {
  return withTestWorkspace((effects, dispose) => {
    const [connected, setConnected] = createSignal(initialConnected);
    const [listed, setListed] = createSignal(initialForms);
    const list = vi.fn<FormApi["list"]>(() => listed());
    const invalidate = vi.fn<FormApi["invalidate"]>();
    const sync = vi.fn<FormApi["sync"]>(async () => undefined);
    const reply = vi.fn<FormApi["reply"]>(async () => undefined);
    const cancel = vi.fn<FormApi["cancel"]>(async () => undefined);
    const events = createOpenCodeEventSource();
    const value = createGlobalForms({
      effects,
      connected,
      location,
      runtime: {
        data: { on: events.on, session: { form: { list, sync, invalidate, reply, cancel } } },
      },
    });
    return {
      dispose,
      value,
      setConnected,
      setListed,
      list,
      invalidate,
      sync,
      reply,
      cancel,
      emitCreated(event: CreatedEvent) {
        events.emit(event);
      },
    };
  });
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("createGlobalForms", () => {
  it("syncs global forms with the complete location on each reconnect", async () => {
    const root = setup();
    await settle();
    expect(root.sync).not.toHaveBeenCalled();

    root.setConnected(true);
    await settle();
    expect(root.sync).toHaveBeenNthCalledWith(1, "global", location);

    root.setConnected(false);
    await settle();
    root.setConnected(true);
    await settle();
    expect(root.sync).toHaveBeenNthCalledWith(2, "global", location);
    root.dispose();
  });

  it("refreshes only for matching global form events and accepts location-less events", async () => {
    const root = setup();
    root.setConnected(true);
    await settle();
    root.sync.mockClear();
    root.invalidate.mockClear();
    const foreignLocation: LocationRef = {
      directory: "/srv/remote/other-project",
      workspaceID: "workspace-feature",
    };

    root.emitCreated(created("target", location));
    await settle();
    expect(root.invalidate).toHaveBeenCalledWith("global", location);
    expect(root.sync).toHaveBeenCalledOnce();

    root.invalidate.mockClear();
    root.sync.mockClear();
    root.emitCreated(created("foreign", foreignLocation));
    root.emitCreated(created("session", location, "session-1"));
    await settle();
    expect(root.invalidate).not.toHaveBeenCalled();
    expect(root.sync).not.toHaveBeenCalled();

    root.emitCreated(created("location-less"));
    await settle();
    expect(root.invalidate).toHaveBeenCalledWith("global", location);
    expect(root.sync).toHaveBeenCalledOnce();
    root.dispose();
  });

  it("queues global revalidation behind an in-flight read after a matching event", async () => {
    const root = setup();
    root.setConnected(true);
    await settle();
    root.sync.mockClear();
    const first = deferred();
    const second = deferred();
    root.sync
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const refresh = root.value.refresh();
    await settle();
    expect(root.sync).toHaveBeenCalledOnce();
    root.emitCreated(created("during-read", location));
    await settle();
    expect(root.invalidate).toHaveBeenCalledWith("global", location);
    expect(root.sync).toHaveBeenCalledTimes(2);

    first.resolve(undefined);
    await settle();
    second.resolve(undefined);
    await refresh;
    expect(root.value.loading()).toBe(false);
    root.dispose();
  });

  it("ignores stale refresh completion without overwriting the current state", async () => {
    const root = setup();
    root.setConnected(true);
    await settle();
    root.sync.mockClear();
    const stale = deferred();
    const current = deferred();
    root.sync
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => current.promise);

    const staleRefresh = root.value.refresh();
    const currentRefresh = root.value.refresh();
    expect(root.value.loading()).toBe(true);

    current.resolve(undefined);
    await currentRefresh;
    expect(root.value.loading()).toBe(false);
    expect(root.value.loadError()).toBeUndefined();

    stale.reject(new Error("stale failure"));
    await staleRefresh;
    expect(root.value.loading()).toBe(false);
    expect(root.value.loadError()).toBeUndefined();
    root.dispose();
  });

  it("invalidates an in-flight refresh when the connection drops", async () => {
    const root = setup();
    const pending = deferred();
    root.sync.mockImplementationOnce(() => pending.promise);

    root.setConnected(true);
    await settle();
    expect(root.value.loading()).toBe(true);

    root.setConnected(false);
    await settle();
    expect(root.value.loading()).toBe(false);
    expect(root.value.loadError()).toBeUndefined();

    pending.reject(new Error("late sync failure"));
    await settle();
    expect(root.value.loading()).toBe(false);
    expect(root.value.loadError()).toBeUndefined();
    root.dispose();
  });

  it("reads the live global queue and sends reply and cancel through the same location", async () => {
    const root = setup(false, [form("one")]);
    expect(root.value.forms().map((item) => item.id)).toEqual(["one"]);
    expect(root.list).toHaveBeenCalledWith("global", location);

    root.setListed([form("two")]);
    root.setConnected(true);
    await settle();
    expect(root.value.forms().map((item) => item.id)).toEqual(["two"]);

    await expect(root.value.reply("two", { answer: "approved" })).resolves.toBe(true);
    expect(root.reply).toHaveBeenCalledWith(
      { sessionID: "global", formID: "two", answer: { answer: "approved" } },
      location,
    );
    await expect(root.value.cancel("two")).resolves.toBe(true);
    expect(root.cancel).toHaveBeenCalledWith({ sessionID: "global", formID: "two" }, location);
    root.dispose();
  });

  it("rejects duplicate same-tick settlement while one form action is queued", async () => {
    const root = setup(false, [form("one")]);
    root.setConnected(true);
    await settle();
    const pending = deferred();
    root.reply.mockImplementationOnce(() => pending.promise);

    const first = root.value.reply("one", { answer: "first" });
    const duplicate = root.value.reply("one", { answer: "duplicate" });
    await expect(duplicate).resolves.toBe(false);
    expect(root.reply).toHaveBeenCalledOnce();

    pending.resolve(undefined);
    await expect(first).resolves.toBe(true);
    expect(root.reply).toHaveBeenCalledWith(
      { sessionID: "global", formID: "one", answer: { answer: "first" } },
      location,
    );
    root.dispose();
  });

  it("keeps pending and errors independent for each form", async () => {
    const root = setup(false, [form("replying"), form("blocked")]);
    root.setConnected(true);
    await settle();
    const replyPending = deferred();
    root.reply.mockImplementationOnce(() => replyPending.promise);
    root.cancel.mockRejectedValueOnce(new Error("Cancellation refused."));

    const reply = root.value.reply("replying", { answer: "approved" });
    const cancel = root.value.cancel("blocked");
    expect(root.value.pending()).toBe(true);
    expect(root.value.submitting("replying")).toBe(true);
    expect(root.value.submitting("blocked")).toBe(true);
    await expect(cancel).resolves.toBe(false);
    expect(root.value.pending()).toBe(true);
    expect(root.value.submitting("blocked")).toBe(false);
    expect(root.value.errorFor("blocked")).toBe("Cancellation refused.");
    expect(root.value.errorFor("replying")).toBeUndefined();

    replyPending.resolve(undefined);
    await expect(reply).resolves.toBe(true);
    expect(root.value.pending()).toBe(false);
    expect(root.value.submitting("replying")).toBe(false);
    root.dispose();
  });

  it("rejects mutations while disconnected without calling the data adapter", async () => {
    const root = setup(false, [form("offline")]);

    await expect(root.value.reply("offline", { answer: "no" })).resolves.toBe(false);
    await expect(root.value.cancel("offline")).resolves.toBe(false);
    expect(root.reply).not.toHaveBeenCalled();
    expect(root.cancel).not.toHaveBeenCalled();
    expect(root.value.pending()).toBe(false);
    root.dispose();
  });
});
