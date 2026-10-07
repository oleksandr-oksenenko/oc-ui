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
    readonly subagentIDs?: readonly string[];
    readonly listed?: FormInfo[];
    readonly sync?: FormData["sync"];
  } = {},
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal(options.selectedID);
    const [subagentIDs, setSubagentIDs] = createSignal<readonly string[]>(
      options.subagentIDs ?? [],
    );
    const [connected, setConnected] = createSignal(true);
    const [listed, setListed] = createSignal<readonly FormInfo[]>(options.listed ?? []);
    const loaded = new Set<string>([
      ...(options.listed ?? []).map((item) => item.sessionID),
      ...(options.selectedID === undefined ? [] : [options.selectedID]),
    ]);
    const sync = vi.fn<FormData["sync"]>(options.sync ?? (() => Promise.resolve()));
    const invalidate = vi.fn<FormData["invalidate"]>();
    const reply = vi.fn<FormData["reply"]>(() => Promise.resolve());
    const cancel = vi.fn<FormData["cancel"]>(() => Promise.resolve());
    const events = createOpenCodeEventSource();
    const list = vi.fn<FormData["list"]>((sessionID) =>
      loaded.has(sessionID) ? listed().filter((item) => item.sessionID === sessionID) : undefined,
    );
    const forms = createSessionForms({
      effects,
      data: {
        on: events.on,
        session: { form: { list, sync, invalidate, reply, cancel } },
      },
      selectedID,
      subagentIDs,
      connected,
    });

    return {
      effects,
      dispose,
      forms,
      loaded,
      setSelectedID,
      setSubagentIDs,
      setConnected,
      setListed: (next: readonly FormInfo[]) => {
        for (const item of next) loaded.add(item.sessionID);
        setListed(next);
      },
      sync,
      invalidate,
      reply,
      cancel,
      emitCreated(event: CreatedEvent) {
        events.emit(event);
      },
      emit: events.emit,
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
  it("takes defensive answer snapshots without exposing stored arrays to callers", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    const choices = ["alpha"];
    const answer: FormAnswer = { answer: "saved", choices };
    fixture.forms.saveAnswer("one", "draft", answer);
    answer.answer = "mutated input";
    choices.push("beta");
    const restored = fixture.forms.answerFor("one", "draft")!;
    expect(restored).toEqual({ answer: "saved", choices: ["alpha"] });
    restored.answer = "mutated output";
    if (!Array.isArray(restored.choices)) throw new Error("Expected restored choices");
    restored.choices.push("gamma");
    expect(fixture.forms.answerFor("one", "draft")).toEqual({
      answer: "saved",
      choices: ["alpha"],
    });
    fixture.dispose();
  });

  it("prevents a superseded successful read from pruning drafts after the current refresh", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "current" });
    const staleRead = deferred();
    fixture.sync.mockReturnValueOnce(staleRead.promise);
    const staleRefresh = fixture.forms.sync();
    await fixture.forms.sync();
    fixture.setListed([]);
    staleRead.resolve();
    await staleRefresh;
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "current" });
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "draft")).toBeUndefined();
    fixture.dispose();
  });

  it("retains drafts when a successful SDK read settles after disconnection cancels it", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "current" });
    const read = deferred();
    fixture.sync.mockReturnValueOnce(read.promise);
    const refresh = fixture.forms.sync();
    fixture.setConnected(false);
    fixture.setListed([]);
    read.resolve();
    await refresh;
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "current" });
    fixture.dispose();
  });

  it("retains distinct session/form drafts through navigation, replacement and missing caches", async () => {
    const fixture = setup({
      selectedID: "one",
      listed: [form("shared", "one"), form("other", "one"), form("shared", "two")],
    });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "shared", { answer: "one", hidden: ["a", "b"] });
    fixture.forms.saveAnswer("one", "other", {});
    fixture.forms.saveAnswer("two", "shared", { answer: false });
    fixture.setSelectedID("two");
    await fixture.forms.sync();
    fixture.setListed([form("shared", "one"), form("other", "one"), form("shared", "two")]);
    fixture.setSelectedID("one");
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "shared")).toEqual({
      answer: "one",
      hidden: ["a", "b"],
    });
    expect(fixture.forms.answerFor("one", "other")).toEqual({});
    expect(fixture.forms.answerFor("two", "shared")).toEqual({ answer: false });
    fixture.loaded.delete("one");
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "shared")?.answer).toBe("one");
    fixture.dispose();
    expect(fixture.forms.answerFor("one", "shared")).toBeUndefined();
  });

  it("retains edits after failed reply/cancel and prunes only the settled identity on retry", async () => {
    const fixture = setup({
      selectedID: "one",
      listed: [form("shared", "one"), form("other", "one"), form("shared", "two")],
    });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "shared", { answer: "reply" });
    fixture.forms.saveAnswer("one", "other", { answer: "cancel" });
    fixture.forms.saveAnswer("two", "shared", { answer: "unrelated" });
    fixture.reply.mockRejectedValueOnce(new Error("reply failed"));
    fixture.cancel.mockRejectedValueOnce(new Error("cancel failed"));
    await fixture.forms.reply("one", "shared", { answer: "reply" });
    await fixture.forms.cancel("one", "other");
    expect(fixture.forms.answerFor("one", "shared")).toEqual({ answer: "reply" });
    expect(fixture.forms.answerFor("one", "other")).toEqual({ answer: "cancel" });
    await fixture.forms.reply("one", "shared", { answer: "reply" });
    expect(fixture.forms.answerFor("one", "shared")).toBeUndefined();
    expect(fixture.forms.answerFor("one", "other")).toEqual({ answer: "cancel" });
    await fixture.forms.cancel("one", "other");
    expect(fixture.forms.answerFor("one", "other")).toBeUndefined();
    expect(fixture.forms.answerFor("two", "shared")).toEqual({ answer: "unrelated" });
    fixture.dispose();
  });

  it("ignores transient list omissions and failed reads, then prunes on authoritative refresh", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "keep" });
    fixture.forms.saveAnswer("two", "draft", { answer: "unselected" });
    fixture.setListed([]);
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "keep" });
    fixture.sync.mockRejectedValueOnce(new Error("catalog unavailable"));
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "keep" });
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "draft")).toBeUndefined();
    expect(fixture.forms.answerFor("two", "draft")).toEqual({ answer: "unselected" });
    fixture.dispose();
  });

  it("does not let a late read erase newer edits, including after leaving the session", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "before" });
    const read = deferred();
    fixture.sync.mockReturnValueOnce(read.promise);
    const refresh = fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "during" });
    fixture.setSelectedID("two");
    fixture.setListed([]);
    read.resolve();
    await refresh;
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "during" });
    fixture.setListed([form("draft", "one")]);
    fixture.setSelectedID("one");
    await fixture.forms.sync();
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "during" });
    fixture.dispose();
  });

  it("prunes unchanged missing forms but retains edits arriving during the current refresh", async () => {
    const fixture = setup({
      selectedID: "one",
      listed: [form("editing", "one"), form("removed", "one")],
    });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "editing", { answer: "old" });
    fixture.forms.saveAnswer("one", "removed", { answer: "old" });
    const read = deferred();
    fixture.sync.mockReturnValueOnce(read.promise);
    const refresh = fixture.forms.sync();
    fixture.forms.saveAnswer("one", "editing", { answer: "new" });
    fixture.setListed([]);
    read.resolve();
    await refresh;
    expect(fixture.forms.answerFor("one", "editing")).toEqual({ answer: "new" });
    expect(fixture.forms.answerFor("one", "removed")).toBeUndefined();
    fixture.dispose();
  });

  it("prunes related forms only after successful hydration and retains them when the subtree changes", async () => {
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: [form("draft", "child")],
    });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("child", "draft", { answer: "child" });
    fixture.setSubagentIDs([]);
    fixture.setListed([]);
    expect(fixture.forms.answerFor("child", "draft")).toEqual({ answer: "child" });
    fixture.sync.mockRejectedValueOnce(new Error("child unavailable"));
    fixture.setSubagentIDs(["child"]);
    fixture.emitCreated(created("child"));
    await vi.waitFor(() => expect(fixture.forms.subagentError()).toBeDefined());
    expect(fixture.forms.answerFor("child", "draft")).toEqual({ answer: "child" });
    await fixture.forms.retrySubagents();
    expect(fixture.forms.answerFor("child", "draft")).toBeUndefined();
    fixture.dispose();
  });

  it("retains pending and late failed submissions across navigation without rollback of edits", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "before" });
    const request = deferred();
    fixture.reply.mockReturnValueOnce(request.promise);
    const submitted = fixture.forms.reply("one", "draft", { answer: "before" });
    fixture.setSelectedID("two");
    fixture.setSelectedID("one");
    fixture.forms.saveAnswer("one", "draft", { answer: "current" });
    await fixture.forms.reply("one", "draft", { answer: "duplicate" });
    expect(fixture.reply).toHaveBeenCalledOnce();
    request.reject(new Error("late failure"));
    await submitted;
    expect(fixture.forms.answerFor("one", "draft")).toEqual({ answer: "current" });
    fixture.dispose();
  });

  it("clears only the acknowledged form when submission succeeds after navigation", async () => {
    const fixture = setup({
      selectedID: "one",
      listed: [form("shared", "one"), form("shared", "two")],
    });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "shared", { answer: "submitted" });
    fixture.forms.saveAnswer("two", "shared", { answer: "current" });
    const request = deferred();
    fixture.reply.mockReturnValueOnce(request.promise);
    const submitted = fixture.forms.reply("one", "shared", { answer: "submitted" });
    fixture.setSelectedID("two");
    request.resolve();
    await submitted;
    expect(fixture.forms.answerFor("one", "shared")).toBeUndefined();
    expect(fixture.forms.answerFor("two", "shared")).toEqual({ answer: "current" });
    fixture.dispose();
  });

  it("awaits pending SDK submission on workspace shutdown and cannot recreate disposed drafts", async () => {
    const fixture = setup({ selectedID: "one", listed: [form("draft", "one")] });
    await fixture.forms.sync();
    fixture.forms.saveAnswer("one", "draft", { answer: "draft" });
    const request = deferred();
    fixture.reply.mockReturnValueOnce(request.promise);
    const submitted = fixture.forms
      .reply("one", "draft", { answer: "draft" })
      .catch(() => undefined);
    fixture.dispose();
    const closed = vi.fn<() => void>();
    const shutdown = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(closed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).not.toHaveBeenCalled();
    request.resolve();
    await shutdown;
    await submitted;
    fixture.forms.saveAnswer("one", "draft", { answer: "late" });
    expect(fixture.forms.answerFor("one", "draft")).toBeUndefined();
  });

  it("prunes unselected and descendant drafts on settlement and session deletion events", async () => {
    const fixture = setup({ selectedID: "one" });
    await fixture.forms.sync();
    for (const sessionID of ["one", "child", "unselected"])
      for (const id of ["shared", "other"])
        fixture.forms.saveAnswer(sessionID, id, { answer: sessionID });
    fixture.emit({
      id: "evt_replied",
      created: 1,
      type: "form.replied",
      data: { sessionID: "unselected", id: "shared", answer: {} },
    });
    fixture.emit({
      id: "evt_cancelled",
      created: 1,
      type: "form.cancelled",
      data: { sessionID: "child", id: "shared" },
    });
    fixture.emit({
      id: "evt_deleted",
      created: 1,
      type: "session.deleted",
      durable: { aggregateID: "unselected", seq: 1, version: 2 },
      data: { sessionID: "unselected" },
    });
    expect(fixture.forms.answerFor("unselected", "shared")).toBeUndefined();
    expect(fixture.forms.answerFor("unselected", "other")).toBeUndefined();
    expect(fixture.forms.answerFor("child", "shared")).toBeUndefined();
    expect(fixture.forms.answerFor("child", "other")).toEqual({ answer: "child" });
    expect(fixture.forms.answerFor("one", "shared")).toEqual({ answer: "one" });
    fixture.dispose();
  });

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
    await fixture.forms.reply("one", "one-form", { answer: "no" });
    await fixture.forms.cancel("one", "one-form");
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
    const reply = fixture.forms.reply("one", "reply-form", answer);
    void fixture.forms.reply("one", "reply-form", answer);
    const cancel = fixture.forms.cancel("one", "cancel-form");
    expect(fixture.forms.submitting("one", "reply-form")).toBe(true);
    expect(fixture.forms.submitting("one", "cancel-form")).toBe(true);
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
    expect(fixture.forms.errorFor("one", "cancel-form")).toBe(
      "The form could not be cancelled. Try again.",
    );
    expect(fixture.forms.errorFor("one", "reply-form")).toBeUndefined();
    replyRequest.resolve();
    await expect(reply).resolves.toBeUndefined();
    expect(fixture.forms.submitting("one", "reply-form")).toBe(false);
    expect(fixture.forms.sessionForms()).toHaveLength(2);
    fixture.dispose();
  });

  it("does not present a late mutation error after selection changes or unmount", async () => {
    const replyRequest = deferred();
    const fixture = setup({ selectedID: "one", listed: [form("one-form", "one")] });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    fixture.reply.mockReturnValueOnce(replyRequest.promise);
    const reply = fixture.forms.reply("one", "one-form", { answer: "yes" });
    fixture.setSelectedID("two");
    fixture.setSelectedID("one");
    replyRequest.reject(new Error("late"));
    await expect(reply).resolves.toBeUndefined();
    expect(fixture.forms.errorFor("one", "one-form")).toBeUndefined();

    fixture.setSelectedID("one");
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    const unmountedReply = deferred();
    fixture.reply.mockReturnValueOnce(unmountedReply.promise);
    const unmounted = fixture.forms.reply("one", "one-form", { answer: "again" });
    fixture.dispose();
    unmountedReply.reject(new Error("unmounted"));
    await unmounted;
  });
});

describe("createSessionForms subagent bubbling", () => {
  it("projects related session forms after the selected session's own", async () => {
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: [form("own-form", "one"), form("child-form", "child")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    expect(fixture.forms.sessionForms().map((item) => item.id)).toEqual(["own-form", "child-form"]);

    fixture.setSubagentIDs([]);
    expect(fixture.forms.sessionForms().map((item) => item.id)).toEqual(["own-form"]);
    fixture.dispose();
  });

  it("answers and cancels a related form through its owning session", async () => {
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: [form("child-form", "child")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    await fixture.forms.reply("child", "child-form", { answer: "yes" });
    expect(fixture.reply).toHaveBeenCalledExactlyOnceWith(
      { sessionID: "child", formID: "child-form", answer: { answer: "yes" } },
      undefined,
    );
    await fixture.forms.cancel("child", "child-form");
    expect(fixture.cancel).toHaveBeenCalledExactlyOnceWith(
      { sessionID: "child", formID: "child-form" },
      undefined,
    );
    expect(fixture.forms.submitting("child", "child-form")).toBe(false);
    fixture.dispose();
  });

  it("hydrates unloaded related caches when connected and syncs created forms", async () => {
    const fixture = setup({
      selectedID: "one",
      sync: async (sessionID) => {
        if (sessionID === "child") fixture.setListed([form("child-form", "child")]);
      },
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    fixture.setSubagentIDs(["child"]);
    await vi.waitFor(() =>
      expect(fixture.forms.sessionForms().map((item) => item.id)).toEqual(["child-form"]),
    );
    expect(fixture.sync).toHaveBeenCalledWith("child", undefined);

    fixture.emitCreated(created("child", "event-form"));
    await vi.waitFor(() => expect(fixture.invalidate).toHaveBeenCalledWith("child"));
    await vi.waitFor(() =>
      expect(
        fixture.sync.mock.calls.filter(([sessionID]) => sessionID === "child").length,
      ).toBeGreaterThan(1),
    );
    fixture.dispose();
  });

  it("keeps primary status independent from a failing related read", async () => {
    const fixture = setup({
      selectedID: "one",
      sync: async (sessionID) => {
        if (sessionID === "child") throw new Error("offline");
      },
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    fixture.setSubagentIDs(["child"]);
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("child", undefined));
    expect(fixture.forms.state()).toBe("ready");
    expect(fixture.forms.error()).toBeUndefined();
    fixture.dispose();
  });

  it("scopes related mutation errors to their own form", async () => {
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: [form("child-form", "child")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));
    fixture.reply.mockRejectedValueOnce(new Error("nope"));

    await fixture.forms.reply("child", "child-form", { answer: "x" });
    expect(fixture.forms.errorFor("child", "child-form")).toBe(
      "The form could not be submitted. Try again.",
    );
    expect(fixture.forms.state()).toBe("ready");
    fixture.dispose();
  });

  it("reports a failed related load and recovers it on retry", async () => {
    let available = false;
    const fixture = setup({
      selectedID: "one",
      sync: async (sessionID) => {
        if (sessionID !== "child") return;
        if (!available) throw new Error("offline");
        fixture.setListed([form("child-form", "child")]);
      },
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    fixture.setSubagentIDs(["child"]);
    await vi.waitFor(() =>
      expect(fixture.forms.subagentError()).toBe("Some subagent questions could not be loaded."),
    );

    available = true;
    await fixture.forms.retrySubagents();
    expect(fixture.forms.subagentError()).toBeUndefined();
    expect(fixture.forms.sessionForms().map((item) => item.id)).toEqual(["child-form"]);
    fixture.dispose();
  });

  it("bounds concurrent related reads across event bursts", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ids,
      listed: ids.map((id) => form(`f-${id}`, id)),
      sync: (sessionID) =>
        sessionID === "one"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              started.push(sessionID);
              releases.push(resolve);
            }),
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    for (const id of ids) fixture.emitCreated(created(id, `event-${id}`));
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(new Set(started)).toEqual(new Set(["a", "b", "c", "d"]));

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(started).toHaveLength(6));
    releases.splice(0).forEach((release) => release());
    fixture.dispose();
  });

  it("cancels queued related hydration when the subtree shrinks", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const fixture = setup({
      selectedID: "one",
      sync: (sessionID) =>
        sessionID === "one"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              started.push(sessionID);
              releases.push(resolve);
            }),
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    fixture.setSubagentIDs(["a", "b", "c", "d", "e", "f"]);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    fixture.setSubagentIDs([]);
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(4);
    fixture.dispose();
  });

  it("routes duplicate form IDs to their own sessions", async () => {
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["child"],
      listed: [form("shared", "one"), form("shared", "child")],
    });
    await vi.waitFor(() => expect(fixture.sync).toHaveBeenCalledWith("one", undefined));

    await fixture.forms.reply("child", "shared", { answer: "child" });
    await fixture.forms.reply("one", "shared", { answer: "own" });
    expect(fixture.reply.mock.calls.map(([input]) => input)).toEqual([
      { sessionID: "child", formID: "shared", answer: { answer: "child" } },
      { sessionID: "one", formID: "shared", answer: { answer: "own" } },
    ]);
    fixture.dispose();
  });

  it("does not start a second related hydration after the primary refresh settles", async () => {
    const primaryRead = deferred();
    const relatedReleases: Array<() => void> = [];
    const fixture = setup({
      selectedID: "one",
      subagentIDs: ["a", "b"],
      sync: (sessionID) => {
        if (sessionID === "one") return primaryRead.promise;
        return new Promise<void>((resolve) => relatedReleases.push(resolve));
      },
    });
    await vi.waitFor(() => expect(relatedReleases).toHaveLength(2));

    primaryRead.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(relatedReleases).toHaveLength(2);

    relatedReleases.forEach((release) => release());
    fixture.dispose();
  });
});
