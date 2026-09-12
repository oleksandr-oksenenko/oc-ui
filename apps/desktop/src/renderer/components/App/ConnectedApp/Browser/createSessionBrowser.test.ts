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

function setup(overrides: Partial<Pick<BrowserApi, "attach" | "detach" | "command">> = {}) {
  return withTestWorkspace((effects, disposeView) => {
    let receive: ((event: BrowserEvent) => void) | undefined;
    const [selected, select] = createSignal<string | undefined>("session-a");
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
    const api: BrowserApi = {
      attach,
      detach,
      command,
      layout: () => Promise.resolve(),
      onEvent: (listener) => {
        receive = listener;
        return stopEvents;
      },
    };
    const focus = vi.fn<(sessionID: string) => void>();
    const connection = { api, serverUrl: "http://server:1234", password: "fixture" };
    const controller = createSessionBrowser({ effects }, api, connection, selected, focus);
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
      attach,
      detach,
      command,
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
