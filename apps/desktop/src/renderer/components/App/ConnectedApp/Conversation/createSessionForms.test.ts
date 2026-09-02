import type { FormAnswer, FormInfo, OpenCodeEvent } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

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
  return createRoot((dispose) => {
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
      data: {
        on: events.on,
        session: { form: { list, sync, invalidate, reply, cancel } },
      },
      selectedID,
      connected,
    });

    return {
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
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    expect(fixture.forms.sessionForms()).toEqual([form("one-form", "one")]);

    fixture.setListed([form("replacement", "one")]);
    expect(fixture.forms.sessionForms()).toEqual([form("replacement", "one")]);

    fixture.setSelectedID(undefined);
    await vi.waitFor(() => expect(fixture.forms.sessionForms()).toEqual([]));
    expect(fixture.sync).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("starts the next selected session without waiting for an active read", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSecond = resolve)));
    const fixture = setup({ selectedID: "one", sync });

    // The setup read is already owned by the controller; wait for its first call.
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one"));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("two"));
    expect(sync).toHaveBeenCalledTimes(2);

    resolveFirst();
    resolveSecond();
    await Promise.resolve();
    fixture.dispose();
  });

  it("invalidates every local form event immediately and ignores global forms", async () => {
    const fixture = setup({ selectedID: "one" });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    fixture.sync.mockClear();
    const order: string[] = [];
    fixture.invalidate.mockImplementation(() => order.push("invalidate"));
    fixture.sync.mockImplementation(async () => {
      order.push("sync");
    });

    fixture.emitCreated(created("one"));
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    expect(order).toEqual(["invalidate", "sync"]);

    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("two"));
    fixture.sync.mockClear();
    fixture.invalidate.mockClear();
    fixture.emitCreated(created("one", "unselected"));
    fixture.emitCreated(created("global", "global"));
    expect(fixture.sync).not.toHaveBeenCalled();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    expect(fixture.invalidate).toHaveBeenCalledWith("one");

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    expect(fixture.invalidate).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("does not sync or mutate while disconnected, and ignores a late sync failure", async () => {
    let rejectSync!: (cause: Error) => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectSync = reject)))
      .mockResolvedValue(undefined);
    const fixture = setup({
      selectedID: "one",
      listed: [form("one-form", "one")],
      sync,
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));

    fixture.setConnected(false);
    await fixture.forms.reply("one-form", { answer: "no" });
    await fixture.forms.cancel("one-form");
    expect(fixture.reply).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();

    rejectSync(new Error("offline"));
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
    let rejectSync!: (cause: Error) => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectSync = reject)));
    const fixture = setup({ selectedID: "one", sync });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one"));
    rejectSync(new Error("offline"));
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("failed"));

    fixture.setConnected(false);
    fixture.setSelectedID("two");

    await vi.waitFor(() => expect(fixture.forms.state()).toBe("ready"));
    expect(fixture.forms.error()).toBeUndefined();
    expect(sync).toHaveBeenCalledOnce();
    fixture.dispose();
  });

  it("does not let an old session failure affect the newly selected session", async () => {
    let rejectFirst!: (cause: Error) => void;
    let resolveSecond!: () => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSecond = resolve)));
    const fixture = setup({ selectedID: "one", sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one"));
    fixture.setSelectedID("two");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("two"));

    rejectFirst(new Error("old session failed"));
    await Promise.resolve();
    expect(fixture.forms.state()).toBe("loading");
    expect(fixture.forms.error()).toBeUndefined();

    resolveSecond();
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("ready"));
    fixture.dispose();
  });

  it("keeps cached forms on failure and returns ready after a successful retry", async () => {
    let rejectFirst!: (cause: Error) => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectFirst = reject)))
      .mockResolvedValue(undefined);
    const listed = [form("cached", "one")];
    const fixture = setup({ selectedID: "one", listed, sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one"));
    rejectFirst(new Error("offline"));
    await vi.waitFor(() => expect(fixture.forms.state()).toBe("failed"));
    expect(fixture.forms.sessionForms()).toEqual(listed);
    expect(fixture.forms.error()).toBe("Forms could not be refreshed. Try again.");

    await fixture.forms.sync();
    expect(fixture.forms.state()).toBe("ready");
    expect(fixture.forms.error()).toBeUndefined();
    fixture.dispose();
  });

  it("invalidates and requests another sync when a form is created during a read", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const sync = vi
      .fn<FormData["sync"]>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSecond = resolve)));
    const fixture = setup({ selectedID: "one", sync });

    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("one"));
    fixture.emitCreated(created("one", "during-sync"));
    expect(fixture.invalidate).toHaveBeenCalledWith("one");
    expect(sync).toHaveBeenCalledTimes(2);

    resolveFirst();
    resolveSecond();
    await Promise.resolve();
    fixture.dispose();
  });

  it("tracks mutations independently, keeps failed forms, and scopes errors per form", async () => {
    let resolveReply!: () => void;
    let rejectCancel!: (cause: Error) => void;
    const fixture = setup({
      selectedID: "one",
      listed: [form("reply-form", "one"), form("cancel-form", "one")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    fixture.reply.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveReply = resolve)),
    );
    fixture.cancel.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (rejectCancel = reject)),
    );

    const answer: FormAnswer = { answer: "yes" };
    const reply = fixture.forms.reply("reply-form", answer);
    void fixture.forms.reply("reply-form", answer);
    const cancel = fixture.forms.cancel("cancel-form");
    expect(fixture.forms.submitting("reply-form")).toBe(true);
    expect(fixture.forms.submitting("cancel-form")).toBe(true);
    expect(fixture.forms.sessionForms()).toHaveLength(2);
    expect(fixture.reply).toHaveBeenCalledWith({ sessionID: "one", formID: "reply-form", answer });
    expect(fixture.reply).toHaveBeenCalledTimes(1);
    expect(fixture.cancel).toHaveBeenCalledWith({ sessionID: "one", formID: "cancel-form" });

    rejectCancel(new Error("cancel failed"));
    await cancel;
    expect(fixture.forms.errorFor("cancel-form")).toBe(
      "The form could not be cancelled. Try again.",
    );
    expect(fixture.forms.errorFor("reply-form")).toBeUndefined();
    resolveReply();
    await reply;
    expect(fixture.forms.submitting("reply-form")).toBe(false);
    expect(fixture.forms.sessionForms()).toHaveLength(2);
    fixture.dispose();
  });

  it("does not present a late mutation error after selection changes or unmount", async () => {
    let rejectReply!: (cause: Error) => void;
    const fixture = setup({ selectedID: "one", listed: [form("one-form", "one")] });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    fixture.reply.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (rejectReply = reject)),
    );
    const reply = fixture.forms.reply("one-form", { answer: "yes" });
    fixture.setSelectedID("two");
    rejectReply(new Error("late"));
    await reply;
    expect(fixture.forms.errorFor("one-form")).toBeUndefined();

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one"));
    fixture.reply.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (rejectReply = reject)),
    );
    const unmounted = fixture.forms.reply("one-form", { answer: "again" });
    fixture.dispose();
    rejectReply(new Error("unmounted"));
    await unmounted;
  });
});
