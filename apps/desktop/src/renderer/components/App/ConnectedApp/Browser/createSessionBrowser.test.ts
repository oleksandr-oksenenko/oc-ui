import { Effect, Exit, Scope } from "effect";
import { Browser } from "@opencode/plugin-browser/rpc";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  emptyBrowserState,
  type BrowserApi,
  type BrowserEvent,
} from "../../../../../shared/browser-api.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { deferred } from "../../../../test/deferred.ts";
import { createSessionBrowser } from "./createSessionBrowser.ts";

const annotationTab = (generation = 0) => ({
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "https://example.test/page",
  title: "Page",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation,
});

function setup(
  overrides: Partial<
    Pick<
      BrowserApi,
      "attach" | "detach" | "command" | "annotationStart" | "annotationCancel" | "forget"
    >
  > = {},
) {
  return withTestWorkspace((effects, disposeView) => {
    let receive: ((event: BrowserEvent) => void) | undefined;
    const [selected, select] = createSignal<string | undefined>("session-a");
    const [open, setOpen] = createSignal(false);
    const stopEvents = vi.fn<() => void>();
    const lifetimes = new Map<string, { promise: Promise<void>; resolve(): void }>();
    const attach = vi.fn<BrowserApi["attach"]>((input) => {
      if (overrides.attach) return overrides.attach(input);
      const pending = deferred();
      lifetimes.set(input.bindingID, pending);
      return pending.promise;
    });
    const detach = vi.fn<BrowserApi["detach"]>((input) => {
      lifetimes.get(input.bindingID)?.resolve();
      return overrides.detach?.(input) ?? Promise.resolve();
    });
    const command = vi.fn<BrowserApi["command"]>(overrides.command ?? (() => Promise.resolve()));
    const annotationStart = vi.fn<BrowserApi["annotationStart"]>(
      overrides.annotationStart ?? (() => Promise.resolve()),
    );
    const annotationCancel = vi.fn<BrowserApi["annotationCancel"]>(
      overrides.annotationCancel ?? (() => Promise.resolve()),
    );
    const forget = vi.fn<BrowserApi["forget"]>(overrides.forget ?? (() => Promise.resolve()));
    const api: BrowserApi = {
      attach,
      detach,
      command,
      annotationStart,
      annotationCancel,
      forget,
      layout: () => Promise.resolve(),
      onEvent: (listener) => {
        receive = listener;
        return stopEvents;
      },
    };
    const focus = vi.fn<(sessionID: string) => void>();
    const onAnnotationBatch =
      vi.fn<(sessionID: string, text: string, files: readonly File[]) => void>();
    const removed = new Set<(sessionID: string) => void>();
    const connection = { api, serverUrl: "http://server:1234", password: "fixture" };
    const controller = createSessionBrowser(
      { effects },
      api,
      connection,
      selected,
      open,
      (handler) => {
        removed.add(handler);
        return () => removed.delete(handler);
      },
      focus,
      onAnnotationBatch,
    );
    const emit = (event: BrowserEvent) => {
      receive?.(event);
      if (event.type === "state" && event.status !== "connected")
        lifetimes.get(event.bindingID)?.resolve();
    };
    const connected = (bindingID: string) =>
      emit({ bindingID, type: "state", status: "connected", state: emptyBrowserState() });
    return {
      controller,
      effects,
      disposeView,
      select,
      selected,
      open,
      setOpen,
      attach,
      detach,
      command,
      annotationStart,
      annotationCancel,
      forget,
      remove: (sessionID: string) => {
        for (const handler of removed) handler(sessionID);
      },
      onAnnotationBatch,
      emit,
      connected,
      focus,
      stopEvents,
    };
  });
}

describe("session browser ownership", () => {
  it("connects on selection without a pane and retains tabs across sessions and view disposal", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    expect(fixture.attach.mock.calls[0]?.[0]).toEqual({
      bindingID: expect.any(String),
      sessionID: "session-a",
      serverUrl: "http://server:1234",
      password: "fixture",
    });
    const first = fixture.controller.current().bindingID!;
    const tab = {
      id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
      url: "http://server/page",
      title: "Page",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    };
    fixture.emit({
      bindingID: first,
      type: "state",
      status: "connected",
      state: { tabs: [tab], focusedTabID: tab.id },
    });
    await vi.waitFor(() => expect(fixture.controller.current().browser.tabs).toEqual([tab]));
    fixture.select("session-b");
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
    fixture.select("session-a");
    expect(fixture.controller.current().browser.tabs).toEqual([tab]);
    fixture.disposeView();
    expect(fixture.detach).not.toHaveBeenCalled();
    await Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void));
    expect(fixture.detach).toHaveBeenCalledTimes(2);
    expect(fixture.stopEvents).toHaveBeenCalledTimes(1);
  });

  it("forwards tab focus only for the session the user is viewing", async () => {
    const fixture = setup();
    const inputs = () => fixture.attach.mock.calls.map(([input]) => input);
    await vi.waitFor(() => expect(inputs()).toHaveLength(1));
    const tab = {
      id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
      url: "http://server/page",
      title: "Page",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    };
    const publishConnected = (bindingID: string) =>
      fixture.emit({
        bindingID,
        type: "state",
        status: "connected",
        state: { tabs: [tab], focusedTabID: tab.id },
      });
    publishConnected(inputs()[0]!.bindingID);
    fixture.select("session-b");
    await vi.waitFor(() => expect(inputs()).toHaveLength(2));
    const background = inputs()[0]!.bindingID;
    const selected = inputs()[1]!.bindingID;
    publishConnected(selected);

    fixture.emit({ bindingID: background, type: "focus", tabID: tab.id });
    expect(fixture.focus).not.toHaveBeenCalled();
    expect(fixture.selected()).toBe("session-b");

    fixture.emit({ bindingID: selected, type: "focus", tabID: tab.id });
    expect(fixture.focus).toHaveBeenCalledTimes(1);
    expect(fixture.focus).toHaveBeenCalledWith("session-b");

    fixture.select("session-a");
    fixture.emit({ bindingID: background, type: "focus", tabID: tab.id });
    expect(fixture.focus).toHaveBeenCalledTimes(2);
    expect(fixture.focus).toHaveBeenLastCalledWith("session-a");
  });

  it("awaits pending setup and detach settlement during owner shutdown", async () => {
    const pending = deferred();
    const closed = deferred();
    const fixture = setup({
      attach: () => pending.promise,
      detach: () => {
        pending.reject(new Error("closed"));
        return closed.promise;
      },
    });
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    let settled = false;
    const closing = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void)).then(() => {
      settled = true;
      return undefined;
    });
    await vi.waitFor(() => expect(fixture.detach).toHaveBeenCalled());
    expect(settled).toBe(false);
    closed.resolve();
    await closing;
    expect(settled).toBe(true);
  });

  it("does not reclaim a replaced attachment and ignores late events from it", async () => {
    const fixture = setup();
    const inputs = () => fixture.attach.mock.calls.map(([input]) => input);
    await vi.waitFor(() => expect(inputs()).toHaveLength(1));
    const first = inputs()[0]!.bindingID;
    fixture.connected(first);
    fixture.emit({
      bindingID: first,
      type: "state",
      status: "replaced",
      state: emptyBrowserState(),
      error: "Another desktop took control.",
    });
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("replaced"));
    expect(fixture.detach).not.toHaveBeenCalled();
    expect(inputs()).toHaveLength(1);
    fixture.select("session-b");
    await vi.waitFor(() => expect(inputs()).toHaveLength(2));
    fixture.select("session-a");
    expect(fixture.controller.current().status).toBe("replaced");
    expect(inputs()).toHaveLength(2);
    fixture.controller.reconnect();
    await vi.waitFor(() => expect(inputs()).toHaveLength(3));
    fixture.connected(first);
    expect(fixture.controller.current().bindingID).toBe(inputs()[2]!.bindingID);
    expect(fixture.controller.current().status).toBe("connecting");
  });

  it("projects an unselected session's closure without duplicating main's cleanup", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    const first = fixture.attach.mock.calls[0]![0].bindingID;
    fixture.select("session-b");
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
    fixture.emit({ bindingID: first, type: "state", status: "closed", state: emptyBrowserState() });
    expect(fixture.controller.current().bindingID).toBe(fixture.attach.mock.calls[1]![0].bindingID);
    expect(fixture.detach).not.toHaveBeenCalled();
    fixture.select("session-a");
    expect(fixture.controller.current().status).toBe("failed");
    expect(fixture.controller.current().bindingID).toBeUndefined();
    expect(fixture.attach).toHaveBeenCalledTimes(2);
  });

  it("does not retry failed setup when switching away and back", async () => {
    const fixture = setup({ attach: () => Promise.reject(new Error("Unavailable")) });
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("failed"));
    fixture.select(undefined);
    fixture.select("session-a");
    expect(fixture.attach).toHaveBeenCalledTimes(1);
    fixture.controller.reconnect();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
  });

  it("reconnects once when a usable connection drops while the pane is open", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    const first = fixture.controller.current().bindingID!;
    fixture.connected(first);
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("connected"));
    fixture.setOpen(true);
    fixture.emit({
      bindingID: first,
      type: "state",
      status: "failed",
      state: emptyBrowserState(),
      error: "dropped",
    });
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
    const second = fixture.attach.mock.calls[1]![0].bindingID;
    fixture.emit({
      bindingID: second,
      type: "state",
      status: "failed",
      state: emptyBrowserState(),
      error: "dropped again",
    });
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("failed"));
    expect(fixture.attach).toHaveBeenCalledTimes(2);
  });

  it("holds a recovery opportunity while the pane is hidden", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    const first = fixture.controller.current().bindingID!;
    fixture.connected(first);
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("connected"));
    fixture.emit({
      bindingID: first,
      type: "state",
      status: "failed",
      state: emptyBrowserState(),
    });
    await vi.waitFor(() => expect(fixture.controller.current().recovery).toBe(true));
    expect(fixture.attach).toHaveBeenCalledTimes(1);
    fixture.setOpen(true);
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
  });

  it("never auto-reclaims a replaced attachment", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    const first = fixture.controller.current().bindingID!;
    fixture.connected(first);
    fixture.setOpen(true);
    fixture.emit({
      bindingID: first,
      type: "state",
      status: "replaced",
      state: emptyBrowserState(),
      error: "Another desktop took control.",
    });
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("replaced"));
    expect(fixture.controller.current().recovery).toBe(false);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
  });

  it("forgets a moved or deleted session and disarms recovery", async () => {
    const fixture = setup();
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    fixture.connected(fixture.controller.current().bindingID!);
    fixture.setOpen(true);
    fixture.remove("session-a");
    await vi.waitFor(() =>
      expect(fixture.forget).toHaveBeenCalledWith({
        serverUrl: "http://server:1234",
        sessionID: "session-a",
      }),
    );
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("failed"));
    expect(fixture.controller.current().recovery).toBe(false);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
  });

  it("reports uncertain command failures without replaying them", async () => {
    const fixture = setup({
      command: () => Promise.reject(new Error("Connection lost; the action may have run.")),
    });
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    fixture.connected(fixture.controller.current().bindingID!);
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("connected"));
    fixture.controller.command({ type: "tabs.open", url: "http://server/page" });
    await vi.waitFor(() => expect(fixture.controller.current().error).toContain("may have run"));
    expect(fixture.command).toHaveBeenCalledTimes(1);
  });
});

describe("browser annotations", () => {
  const connect = async (fixture: ReturnType<typeof setup>) => {
    await vi.waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(1));
    const bindingID = fixture.controller.current().bindingID!;
    fixture.emit({
      bindingID,
      type: "state",
      status: "connected",
      state: { tabs: [annotationTab()], focusedTabID: annotationTab().id },
    });
    await vi.waitFor(() => expect(fixture.controller.current().status).toBe("connected"));
    return bindingID;
  };
  const capture = (bindingID: string, requestID: string, number: number) =>
    ({
      bindingID,
      type: "annotation",
      capture: {
        requestID,
        number,
        mode: "element",
        tab: annotationTab(),
        capturedAt: "2026-09-19T00:00:00.000Z",
        selection: {
          frameUrl: annotationTab().url,
          selector: "h1",
          tag: "h1",
          text: "Heading",
          role: "",
          label: "",
          bounds: { x: 1, y: 2, width: 30, height: 40 },
          topFrame: true,
        },
        body: `Comment ${number}`,
        image: {
          id: Browser.FileID.make("file_00000000-0000-4000-8000-000000000001"),
          name: `annotation-${number}.png`,
          mime: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      },
    }) satisfies BrowserEvent;
  const annotateAndCapture = async (fixture: ReturnType<typeof setup>, bindingID: string) => {
    fixture.controller.annotate("element");
    const call = fixture.annotationStart.mock.calls.at(-1)![0];
    fixture.emit(capture(bindingID, call.requestID, call.number));
    await vi.waitFor(() =>
      expect(
        fixture.controller.annotations().items.some((item) => item.number === call.number),
      ).toBe(true),
    );
    return call;
  };

  it("captures a numbered annotation and adds it to the composer", async () => {
    const fixture = setup();
    const bindingID = await connect(fixture);
    const call = await annotateAndCapture(fixture, bindingID);
    expect(call).toMatchObject({
      bindingID,
      tabID: annotationTab().id,
      number: 1,
      mode: "element",
    });
    const [item] = fixture.controller.annotations().items;
    expect(item?.number).toBe(1);
    expect(item?.body).toBe("Comment 1");
    fixture.controller.annotationBody(item!.id, "Make this heading larger");
    fixture.controller.addAnnotations();
    expect(fixture.onAnnotationBatch).toHaveBeenCalledTimes(1);
    const [sessionID, text, files] = fixture.onAnnotationBatch.mock.calls[0]!;
    expect(sessionID).toBe("session-a");
    expect(text).toContain("Make this heading larger");
    expect(text).toContain('"selector": "h1"');
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("annotation-1.png");
    expect(fixture.controller.annotations().items).toHaveLength(0);
  });

  it("keeps stable numbers with gaps and discards one annotation", async () => {
    const fixture = setup();
    const bindingID = await connect(fixture);
    await annotateAndCapture(fixture, bindingID);
    await annotateAndCapture(fixture, bindingID);
    const first = fixture.controller.annotations().items[0]!;
    fixture.controller.discardAnnotation(first.id);
    fixture.controller.annotate("element");
    const call = fixture.annotationStart.mock.calls.at(-1)![0];
    expect(call.number).toBe(3);
    fixture.emit(capture(bindingID, call.requestID, call.number));
    await vi.waitFor(() => expect(fixture.controller.annotations().items).toHaveLength(2));
    expect(fixture.controller.annotations().items.map((item) => item.number)).toEqual([2, 3]);
  });

  it("cancels the native pick when the workspace closes mid-request", async () => {
    const pending = deferred();
    const fixture = setup({ annotationStart: () => pending.promise });
    const bindingID = await connect(fixture);
    fixture.controller.annotate("element");
    await vi.waitFor(() => expect(fixture.annotationStart).toHaveBeenCalledOnce());
    const closing = Effect.runPromise(Scope.close(fixture.effects.scope, Exit.void));
    await vi.waitFor(() =>
      expect(fixture.annotationCancel).toHaveBeenCalledWith({
        bindingID,
        tabID: annotationTab().id,
      }),
    );
    pending.resolve();
    await closing;
  });

  it("cancels the native pick and ignores its late capture", async () => {
    const fixture = setup();
    const bindingID = await connect(fixture);
    fixture.controller.annotate("area");
    const call = fixture.annotationStart.mock.calls.at(-1)![0];
    fixture.controller.cancelAnnotation();
    expect(fixture.annotationCancel).toHaveBeenCalledWith({ bindingID, tabID: annotationTab().id });
    expect(fixture.controller.annotations().status).toBe("idle");
    fixture.emit(capture(bindingID, call.requestID, call.number));
    expect(fixture.controller.annotations().items).toHaveLength(0);
  });

  it("refuses to send until every annotation has a comment", async () => {
    const fixture = setup();
    const bindingID = await connect(fixture);
    await annotateAndCapture(fixture, bindingID);
    const [item] = fixture.controller.annotations().items;
    fixture.controller.annotationBody(item!.id, "  ");
    fixture.controller.addAnnotations();
    expect(fixture.onAnnotationBatch).not.toHaveBeenCalled();
    expect(fixture.controller.annotations().error).toMatch(/comment/);
    expect(fixture.controller.annotations().items).toHaveLength(1);
  });

  it("stops capturing at the annotation limit", async () => {
    const fixture = setup();
    const bindingID = await connect(fixture);
    for (let index = 0; index < 8; index++) await annotateAndCapture(fixture, bindingID);
    expect(fixture.controller.annotations().items).toHaveLength(8);
    fixture.controller.annotate("element");
    expect(fixture.annotationStart).toHaveBeenCalledTimes(8);
    expect(fixture.controller.annotations().error).toMatch(/At most 8/);
  });
});
