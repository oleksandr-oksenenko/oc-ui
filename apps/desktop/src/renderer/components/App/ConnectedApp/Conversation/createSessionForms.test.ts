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
