import { Effect, Exit, Scope } from "effect";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import type { FormAnswer, FormInfo, OpenCodeEvent } from "@opencode/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../../../../test/deferred.ts";
import { createOpenCodeEventSource } from "../../../../opencode/event-source.ts";
import { createSessionForms } from "./createSessionForms.ts";

type FormsInput = Parameters<typeof createSessionForms>[0];
type FormData = FormsInput["data"]["session"]["form"];
type CreatedEvent = Extract<OpenCodeEvent, { type: "form.created" }>;

function form(id: string, sessionID: string): FormInfo {
  return {
    id,
    sessionID,
    title: id,
    fields: [{ type: "string", key: "answer", title: "Answer", required: true }],
  };
}

function setup(
  options: {
    readonly selectedID?: string;
    readonly listed?: FormInfo[];
    readonly sync?: FormData["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [connected, setConnected] = createSignal(true);
    const [listed, setListed] = createSignal<ReturnType<FormData["list"]>>(options.listed ?? []);
    const sync = vi.fn<FormData["sync"]>(options.sync ?? (() => Promise.resolve()));
    const invalidate = vi.fn<FormData["invalidate"]>();
    const reply = vi.fn<FormData["reply"]>(() => Promise.resolve());
    const cancel = vi.fn<FormData["cancel"]>(() => Promise.resolve());
    const events = createOpenCodeEventSource();
    const list = vi.fn<FormData["list"]>(() => listed());
    const forms = createSessionForms({
      effects,
      data: {
        on: events.on,
        session: { form: { list, sync, invalidate, reply, cancel } },
      },
      selectedID,
      connected,
    });

    return {
      effects,
      dispose,
      forms,
      setSelectedID,
      setConnected,
      setListed,
      sync,
      invalidate,
      reply,
      cancel,
      emitCreated(event: CreatedEvent) {
        events.emit(event);
      },
    };
  });
}

function created(sessionID: string, id = "new-form"): CreatedEvent {
  return {
    id: `event-${id}`,
    created: 1,
    type: "form.created",
    data: {
      form: {
        ...form(id, sessionID),
        metadata: {},
        fields: [{ type: "string", key: "answer", title: "Answer", required: true }],
      },
    },
  };
}

describe("createSessionForms", () => {
  it("is ready and does not start a refresh without a selected session", async () => {
    const fixture = setup();
    expect(fixture.forms.state()).toBe("ready");
    await fixture.forms.sync();
    expect(fixture.sync).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("syncs only the selected session and projects its live form list", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("one-form", "one")] });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    expect(fixture.forms.sessionForms()).toEqual([form("one-form", "one")]);

    fixture.setListed([form("replacement", "one")]);
    expect(fixture.forms.sessionForms()).toEqual([form("replacement", "one")]);

    fixture.setSelectedID(undefined);
    await vi.waitFor(() => expect(fixture.forms.sessionForms()).toEqual([]));
    expect(fixture.sync).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("starts the next selected session without waiting for an active read", async () => {
    const firstRead = deferred();
    const secondRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    const fixture = setup({ selectedID: "one", sync });

    // The setup read is already owned by the controller; wait for its first call.
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one", undefined));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("two", undefined));
    expect(sync).toHaveBeenCalledTimes(2);

    firstRead.resolve();
    secondRead.resolve();
    await Promise.resolve();
    fixture.dispose();
  });

  it("retains replaced reads until they settle during workspace shutdown", async () => {
    const oldRead = deferred();
    const currentRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(currentRead.promise);
    const fixture = setup({ selectedID: "one", sync });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());

    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    fixture.dispose();
    const closed = vi.fn<() => void>();
    const shutdown = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(closed);
    currentRead.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).not.toHaveBeenCalled();

    oldRead.resolve();
    await shutdown;
    expect(closed).toHaveBeenCalledOnce();
  });

  it("invalidates every local form event immediately and ignores global forms", async () => {
    const fixture = setup({ selectedID: "one" });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    fixture.sync.mockClear();
    const order: string[] = [];
    fixture.invalidate.mockImplementation(() => order.push("invalidate"));
    fixture.sync.mockImplementation(async () => {
      order.push("sync");
    });

    fixture.emitCreated(created("one"));
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    expect(order).toEqual(["invalidate", "sync"]);

    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("two", undefined));
    fixture.sync.mockClear();
    fixture.invalidate.mockClear();
    fixture.emitCreated(created("one", "unselected"));
    fixture.emitCreated(created("global", "global"));
    expect(fixture.sync).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    expect(fixture.invalidate).toHaveBeenCalledWith("one");

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("does not sync or mutate while disconnected, and ignores a late sync failure", async () => {
    const syncRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(syncRead.promise)
      .mockResolvedValue(undefined);
    const fixture = setup({
      selectedID: "one",
      listed: [form("one-form", "one")],
      sync,
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    fixture.setConnected(false);
    await fixture.forms.reply("one-form", { answer: "no" });
    await fixture.forms.cancel("one-form");
    expect(fixture.reply).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();

    syncRead.reject(new Error("offline"));
    await Promise.resolve();
    expect(fixture.forms.error()).toBeUndefined();
    fixture.setConnected(true);
    await Promise.resolve();
    expect(fixture.sync).toHaveBeenCalledTimes(2);
    await fixture.forms.sync();
    expect(fixture.sync).toHaveBeenCalledTimes(3);
    fixture.dispose();
  });

  it("clears the previous session state when selection changes while disconnected", async () => {
    const syncRead = deferred();
    const sync = vi.fn<FormData["sync"]>().mockReturnValueOnce(syncRead.promise);
    const fixture = setup({ selectedID: "one", sync });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one", undefined));
    syncRead.reject(new Error("offline"));
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("failed"));

    fixture.setConnected(false);
    fixture.setSelectedID("two");

    await vi.waitFor(() => expect(fixture.forms.state()).toBe("ready"));
    expect(fixture.forms.error()).toBeUndefined();
    expect(sync).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("does not let an old session failure affect the newly selected session", async () => {
    const firstRead = deferred();
    const secondRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    const fixture = setup({ selectedID: "one", sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one", undefined));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("two", undefined));

    firstRead.reject(new Error("old session failed"));
    await Promise.resolve();
    expect(fixture.forms.state()).toBe("loading");
    expect(fixture.forms.error()).toBeUndefined();

    secondRead.resolve();
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("ready"));
    fixture.dispose();
  });

  it("keeps cached forms on failure and returns ready after a successful retry", async () => {
    const firstRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValue(undefined);
    const listed = [form("cached", "one")];
    const fixture = setup({ selectedID: "one", listed, sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one", undefined));
    firstRead.reject(new Error("offline"));
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("failed"));
    expect(fixture.forms.sessionForms()).toEqual(listed);
    expect(fixture.forms.error()).toBe("Forms could not be refreshed. Try again.");

    await fixture.forms.sync();
    expect(fixture.forms.state()).toBe("ready");
    expect(fixture.forms.error()).toBeUndefined();
    fixture.dispose();
  });

  it("invalidates and requests another sync when a form is created during a read", async () => {
    const firstRead = deferred();
    const secondRead = deferred();
    const sync = vi
      .fn<FormData["sync"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    const fixture = setup({ selectedID: "one", sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one", undefined));
    fixture.emitCreated(created("one", "during-sync"));
    expect(fixture.invalidate).toHaveBeenCalledWith("one");
    expect(sync).toHaveBeenCalledTimes(2);

    firstRead.resolve();
    secondRead.resolve();
    await Promise.resolve();
    fixture.dispose();
  });

  it("tracks mutations independently, keeps failed forms, and scopes errors per form", async () => {
    const replyRequest = deferred();
    const cancelRequest = deferred();
    const fixture = setup({
      selectedID: "one",
      listed: [form("reply-form", "one"), form("cancel-form", "one")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    fixture.reply.mockReturnValueOnce(replyRequest.promise);
    fixture.cancel.mockReturnValueOnce(cancelRequest.promise);

    const answer: FormAnswer = { answer: "yes" };
    const reply = fixture.forms.reply("reply-form", answer);
    void fixture.forms.reply("reply-form", answer);
    const cancel = fixture.forms.cancel("cancel-form");
    expect(fixture.forms.submitting("reply-form")).toBe(true);
    expect(fixture.forms.submitting("cancel-form")).toBe(true);
    expect(fixture.forms.sessionForms()).toHaveLength(2);
    expect(fixture.reply).toHaveBeenCalledWith(
      { sessionID: "one", formID: "reply-form", answer },
      undefined,
    );
    expect(fixture.reply).toHaveBeenCalledTimes(1);
    expect(fixture.cancel).toHaveBeenCalledWith(
      { sessionID: "one", formID: "cancel-form" },
      undefined,
    );

    cancelRequest.reject(new Error("cancel failed"));
    await expect(cancel).resolves.toBeUndefined();
    expect(fixture.forms.errorFor("cancel-form")).toBe(
      "The form could not be cancelled. Try again.",
    );
    expect(fixture.forms.errorFor("reply-form")).toBeUndefined();
    replyRequest.resolve();
    await expect(reply).resolves.toBeUndefined();
    expect(fixture.forms.submitting("reply-form")).toBe(false);
    expect(fixture.forms.sessionForms()).toHaveLength(2);
    fixture.dispose();
  });

  it("does not present a late mutation error after selection changes or unmount", async () => {
    const replyRequest = deferred();
    const fixture = setup({ selectedID: "one", listed: [form("one-form", "one")] });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    fixture.reply.mockReturnValueOnce(replyRequest.promise);
    const reply = fixture.forms.reply("one-form", { answer: "yes" });
    fixture.setSelectedID("two");
    fixture.setSelectedID("one");
    replyRequest.reject(new Error("late"));
    await expect(reply).resolves.toBeUndefined();
    expect(fixture.forms.errorFor("one-form")).toBeUndefined();

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    const unmountedReply = deferred();
    fixture.reply.mockReturnValueOnce(unmountedReply.promise);
    const unmounted = fixture.forms.reply("one-form", { answer: "again" });
    fixture.dispose();
    unmountedReply.reject(new Error("unmounted"));
    await unmounted;
  });
});
