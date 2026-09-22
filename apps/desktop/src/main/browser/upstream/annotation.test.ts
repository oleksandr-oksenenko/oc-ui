// @vitest-environment node
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import type { Browser } from "@opencode/plugin-browser/rpc";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserSelection } from "../../../shared/browser-api.ts";
import type { Cdp } from "./cdp.ts";
import {
  createAnnotationPicker,
  type AnnotationCaptureInput,
  type AnnotationElementInfo,
} from "./annotation.ts";

const BOUNDS = { x: 10, y: 20, width: 100, height: 30 };

const selection: BrowserSelection = {
  frameUrl: "https://example.test/page",
  selector: "h1",
  tag: "h1",
  text: "Heading",
  role: "",
  label: "",
  bounds: BOUNDS,
  topFrame: true,
};

const info = (overrides: Partial<AnnotationElementInfo> = {}): AnnotationElementInfo => ({
  selection,
  visible: true,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

function setup(
  options: {
    element?: AnnotationElementInfo;
    /** `null` simulates dismissing the comment popover. */
    comment?: string | null;
    /** Fails the Overlay reset instead of acknowledging it. */
    failDisarm?: boolean;
  } = {},
) {
  const events = new EventEmitter();
  const trace: string[] = [];
  let holdInspect: (() => void) | undefined;
  let holdArmed = false;
  const hangs = new Map<string, PromiseWithResolvers<void>>();
  let terminal: Error | undefined;
  const releaseAll = () => {
    hangs.forEach((entry) => entry.resolve());
    hangs.clear();
  };
  const send = vi.fn(
    async (method: string, params?: { mode?: string; highlightConfig?: unknown }) => {
      trace.push(`cdp:${method}`);
      const held = hangs.get(method);
      if (held) await held.promise;
      if (terminal) throw terminal;
      if (options.failDisarm && method === "Overlay.setInspectMode" && params?.mode === "none")
        throw new Error("overlay reset failed");
      if (holdArmed && method === "Overlay.setInspectMode" && params?.mode === "searchForNode")
        await new Promise<void>((resolve) => (holdInspect = resolve));
      if (method === "Runtime.evaluate") return { result: { value: true } };
      return {};
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal CDP fixture; the picker only sends and listens.
  const cdp = {
    send,
    on: (name: string, callback: (params: unknown, sessionID?: string) => void) => {
      const handler = (params: unknown, sessionID?: string) => callback(params, sessionID);
      events.on(name, handler);
      return () => events.off(name, handler);
    },
  } as unknown as Cdp;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal Electron fixture; only these members are used.
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    focus: vi.fn(),
  }) as unknown as WebContents;
  const tab: Browser.Tab = {
    id: "tab_00000000-0000-4000-8000-000000000001" as Browser.TabID,
    url: "https://example.test/page",
    title: "Fixture",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    generation: 0,
  };
  const current = { ...tab };
  const element = vi.fn(async () => options.element ?? info());
  const capture = vi.fn(async (_input: AnnotationCaptureInput) => {
    trace.push("capture");
    return {
      id: "file_00000000-0000-4000-8000-000000000001" as Browser.FileID,
      name: "annotation-1.png",
      mime: "image/png",
      data: new Uint8Array([1, 2, 3]),
    };
  });
  const comment = vi.fn(async () => {
    trace.push("comment");
    if (options.comment === null) return undefined;
    return options.comment ?? "Make it bigger";
  });
  const retire = vi.fn((reason: string) => {
    terminal ??= new Error(reason);
    releaseAll();
  });
  const picker = createAnnotationPicker({
    contents,
    cdp,
    state: () => current,
    ready: () => Promise.resolve(),
    retired: () => terminal,
    retire,
    element,
    capture,
    comment,
  });
  return {
    picker,
    element,
    capture,
    comment,
    retire,
    trace,
    send,
    tab: current,
    contents,
    emit: (name: string, params: object) => events.emit(name, params, undefined),
    ready: () => vi.waitFor(() => expect(contents.focus).toHaveBeenCalled()),
    holdArming: () => {
      holdArmed = true;
    },
    releaseArming: () => holdInspect?.(),
    hang: (method: string) => {
      const entry = Promise.withResolvers<void>();
      hangs.set(method, entry);
      return entry;
    },
    release: (method: string) => {
      hangs.get(method)?.resolve();
      hangs.delete(method);
    },
  };
}

describe("annotation picker", () => {
  it("captures an element after hiding the inspect highlight", async () => {
    const fixture = setup();
    const pending = fixture.picker.start(
      { number: 3, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    const result = await pending;
    expect(result?.image.name).toBe("annotation-1.png");
    expect(fixture.capture).toHaveBeenCalledWith(
      { number: 3, mode: "element", markerBounds: BOUNDS },
      expect.any(AbortSignal),
    );
    expect(fixture.element).toHaveBeenCalledTimes(2);
    expect(fixture.trace.indexOf("cdp:Overlay.hideHighlight")).toBeLessThan(
      fixture.trace.indexOf("capture"),
    );
    // Chromium rejects `setInspectMode` without a highlight config, even when disabling.
    const inspectModes = fixture.send.mock.calls.filter(
      ([method]) => method === "Overlay.setInspectMode",
    );
    expect(inspectModes.length).toBeGreaterThanOrEqual(2);
    for (const [, params] of inspectModes) expect(params?.highlightConfig).toBeDefined();
    await fixture.picker.dispose();
    expect(fixture.contents.listenerCount("did-start-navigation")).toBe(0);
  });

  it("resolves undefined when the user cancels with Escape", async () => {
    const fixture = setup();
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectModeCanceled", {});
    await expect(pending).resolves.toBeUndefined();
    expect(fixture.capture).not.toHaveBeenCalled();
    expect(fixture.trace.filter((entry) => entry === "cdp:Overlay.setInspectMode")).toHaveLength(2);
    await fixture.picker.dispose();
  });

  it("ignores a selection event that arrives before the pick is armed", async () => {
    const fixture = setup();
    fixture.holdArming();
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(fixture.send).toHaveBeenCalled());
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    fixture.releaseArming();
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 9 });
    await expect(pending).resolves.toBeDefined();
    expect(fixture.element).toHaveBeenCalledTimes(2);
    await fixture.picker.dispose();
  });

  it("cancels on navigation and awaits cleanup before another pick starts", async () => {
    const fixture = setup();
    const first = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.contents.emit("did-start-navigation", { isMainFrame: true });
    await expect(first).resolves.toBeUndefined();
    const second = fixture.picker.start(
      { number: 2, mode: "element" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(fixture.contents.focus).toHaveBeenCalledTimes(2));
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(second).resolves.toBeDefined();
    await fixture.picker.dispose();
  });

  it("rejects an element that scrolled out of view instead of drawing a wrong marker", async () => {
    const fixture = setup({ element: info({ visible: false }) });
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(pending).rejects.toThrow(/no longer visible/);
    expect(fixture.capture).not.toHaveBeenCalled();
    await fixture.picker.dispose();
  });

  it("rejects a capture whose geometry moved between the screenshot and validation", async () => {
    const fixture = setup();
    fixture.element
      .mockResolvedValueOnce(info())
      .mockResolvedValueOnce(info({ selection: { ...selection, bounds: { ...BOUNDS, y: 90 } } }));
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(pending).rejects.toThrow(/Page changed/);
    await fixture.picker.dispose();
  });

  it("captures a child-frame element without top-viewport marker geometry", async () => {
    const fixture = setup({
      element: info({ selection: { ...selection, topFrame: false } }),
    });
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(pending).resolves.toBeDefined();
    expect(fixture.capture).toHaveBeenCalledWith(
      { number: 1, mode: "element", markerBounds: undefined },
      expect.any(AbortSignal),
    );
    await fixture.picker.dispose();
  });

  it("captures an area from the dragged viewport without probing a node", async () => {
    const fixture = setup();
    const pending = fixture.picker.start({ number: 2, mode: "area" }, new AbortController().signal);
    await fixture.ready();
    fixture.emit("Overlay.screenshotRequested", {
      viewport: { x: 1, y: 2, width: 50, height: 60, scale: 1 },
    });
    await expect(pending).resolves.toBeDefined();
    expect(fixture.capture).toHaveBeenCalledWith(
      { number: 2, mode: "area", markerBounds: { x: 1, y: 2, width: 50, height: 60 } },
      expect.any(AbortSignal),
    );
    expect(fixture.element).not.toHaveBeenCalled();
    await fixture.picker.dispose();
  });

  it("rejects a second pick while one is active", async () => {
    const fixture = setup();
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    expect(() =>
      fixture.picker.start({ number: 2, mode: "element" }, new AbortController().signal),
    ).toThrow(/Finish or cancel/);
    fixture.emit("Overlay.inspectModeCanceled", {});
    await pending;
    await fixture.picker.dispose();
  });

  it("returns the popover comment with the capture", async () => {
    const fixture = setup({ comment: "Tighten the spacing" });
    const pending = fixture.picker.start(
      { number: 4, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    const result = await pending;
    expect(result?.body).toBe("Tighten the spacing");
    expect(fixture.comment).toHaveBeenCalledWith(BOUNDS, expect.any(AbortSignal));
    // The screenshot is captured before the popover opens so it stays out of the image.
    expect(fixture.trace.indexOf("capture")).toBeLessThan(fixture.trace.indexOf("comment"));
    await fixture.picker.dispose();
  });

  it("discards the capture when the popover is dismissed", async () => {
    const fixture = setup({ comment: null });
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(pending).resolves.toBeUndefined();
    expect(fixture.capture).toHaveBeenCalledOnce();
    await fixture.picker.dispose();
  });

  it("fails the pick when the comment box does not open", async () => {
    const fixture = setup();
    fixture.comment.mockRejectedValueOnce(
      new Error("The comment box did not open. Select the element again."),
    );
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await expect(pending).rejects.toThrow(/comment box did not open/);
    await fixture.picker.dispose();
  });

  it("keeps the pane editor for child-frame selections", async () => {
    const fixture = setup({
      element: info({ selection: { ...selection, topFrame: false } }),
    });
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    const result = await pending;
    expect(result?.body).toBe("");
    expect(fixture.comment).not.toHaveBeenCalled();
    await fixture.picker.dispose();
  });

  it("asks for the comment over the selected area", async () => {
    const fixture = setup({ comment: "Uneven cards" });
    const pending = fixture.picker.start({ number: 2, mode: "area" }, new AbortController().signal);
    await fixture.ready();
    fixture.emit("Overlay.screenshotRequested", {
      viewport: { x: 1, y: 2, width: 50, height: 60, scale: 1 },
    });
    const result = await pending;
    expect(result?.body).toBe("Uneven cards");
    expect(fixture.comment).toHaveBeenCalledWith(
      { x: 1, y: 2, width: 50, height: 60 },
      expect.any(AbortSignal),
    );
    await fixture.picker.dispose();
  });

  it("retires the page when a cancelled pick cannot drain", async () => {
    vi.useFakeTimers();
    const fixture = setup();
    fixture.hang("Overlay.enable");
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.send).toHaveBeenCalledWith("Overlay.enable");
    const stopping = fixture.picker.stop();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fixture.retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).rejects.toThrow(/stopped responding/);
    await stopping;
    expect(fixture.retire).toHaveBeenCalledWith(
      "The browser tab stopped responding during cancellation and was closed. Open the page again.",
    );
    await fixture.picker.dispose();
  });

  it("keeps the page when a stalled send settles inside the drain budget", async () => {
    vi.useFakeTimers();
    const fixture = setup();
    fixture.hang("Overlay.enable");
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    const stopping = fixture.picker.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    fixture.release("Overlay.enable");
    await expect(pending).resolves.toBeUndefined();
    await stopping;
    expect(fixture.retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.retire).not.toHaveBeenCalled();
    await fixture.picker.dispose();
  });

  it("retires the page when the overlay cannot be reset", async () => {
    const fixture = setup({ failDisarm: true });
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectModeCanceled", {});
    await expect(pending).resolves.toBeUndefined();
    expect(fixture.retire).toHaveBeenCalledWith(
      "The browser tab could not be reset safely and was closed. Open the page again.",
    );
    await fixture.picker.dispose();
  });

  it("does not emit a child-frame capture cancelled during the final probe", async () => {
    const fixture = setup({
      element: info({ selection: { ...selection, topFrame: false } }),
    });
    const held = Promise.withResolvers<AnnotationElementInfo>();
    fixture.element
      .mockResolvedValueOnce(info({ selection: { ...selection, topFrame: false } }))
      .mockReturnValueOnce(held.promise);
    const pending = fixture.picker.start(
      { number: 1, mode: "element" },
      new AbortController().signal,
    );
    await fixture.ready();
    fixture.emit("Overlay.inspectNodeRequested", { backendNodeId: 7 });
    await vi.waitFor(() => expect(fixture.element).toHaveBeenCalledTimes(2));
    const stopping = fixture.picker.stop();
    held.resolve(info({ selection: { ...selection, topFrame: false } }));
    await expect(pending).resolves.toBeUndefined();
    await stopping;
    expect(fixture.capture).toHaveBeenCalledOnce();
    await fixture.picker.dispose();
  });
});
