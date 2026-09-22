import type { WebContents } from "electron";
import type { Browser } from "@opencode/plugin-browser/rpc";
import type { BrowserSelection } from "../../../shared/browser-api.ts";
import type { Cdp } from "./cdp.ts";
import { createNativeOperation, type NativeOperation } from "./operation.ts";

export type AnnotationMode = "element" | "area";

export type AnnotationElementInfo = {
  readonly selection: BrowserSelection;
  readonly visible: boolean;
};

export type AnnotationCaptureInput = {
  readonly number: number;
  readonly mode: AnnotationMode;
  /** Present only when the marker can be drawn in top-viewport coordinates. */
  readonly markerBounds?: { x: number; y: number; width: number; height: number };
};

export type AnnotationResult = {
  readonly tab: Browser.Tab;
  readonly mode: AnnotationMode;
  readonly selection: BrowserSelection;
  readonly image: Browser.File;
  /** Empty only when the in-page popover was unavailable; the pane edits those. */
  readonly body: string;
};

export type AnnotationPickerOptions = {
  readonly contents: WebContents;
  readonly cdp: Cdp;
  readonly state: () => Browser.Tab;
  /** Page readiness, owned by the pick so a hung load drains with the operation. */
  readonly ready: () => Promise<void>;
  /** The page's terminal failure, when it has already been retired. */
  readonly retired: () => Error | undefined;
  /** Retire a page whose Overlay state could not be confirmed reset. */
  readonly retire: (reason: string) => void;
  /** Resolves the inspected node; `undefined` when it is already gone. */
  readonly element: (
    target: { backendNodeId: number; sessionID?: string },
    signal: AbortSignal,
  ) => Promise<AnnotationElementInfo>;
  /** Captures the viewport and composites the marker when bounds are known. */
  readonly capture: (input: AnnotationCaptureInput, signal: AbortSignal) => Promise<Browser.File>;
  /** Resolves the comment, or `undefined` when cancelled; rejects when the editor is unavailable. */
  readonly comment: (
    anchor: { x: number; y: number; width: number; height: number },
    signal: AbortSignal,
  ) => Promise<string | undefined>;
};

const MOVED_TOLERANCE = 1.5;
// This Chromium validates `highlightConfig` on every `setInspectMode` call,
// including `mode: "none"`, so cleanup passes the same descriptor.
const HIGHLIGHT_CONFIG = {
  showInfo: true,
  contentColor: { r: 74, g: 130, b: 255, a: 0.25 },
  borderColor: { r: 74, g: 130, b: 255, a: 1 },
};
const STOPPED_RESPONDING =
  "The browser tab stopped responding during cancellation and was closed. Open the page again.";
const CLEANUP_FAILURE =
  "The browser tab could not be reset safely and was closed. Open the page again.";

class AnnotationCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationCancelled";
  }
}

/**
 * Owns Chromium's element inspector for one tab. Exactly one pick is active at
 * a time; cancellation is idempotent and a late Overlay event can never settle
 * a newer pick, because listeners only accept events after the current pick is
 * armed and they are removed when it settles. A page is reusable only after its
 * Overlay cleanup is confirmed; otherwise the operation owner retires it.
 */
export function createAnnotationPicker(options: AnnotationPickerOptions) {
  let active:
    | {
        readonly token: number;
        readonly operation: NativeOperation;
        readonly pending: Promise<AnnotationResult | undefined>;
      }
    | undefined;
  let nextToken = 0;

  const stop = async (): Promise<void> => {
    const current = active;
    if (!current) return;
    current.operation.cancel();
    await current.pending.then(
      () => undefined,
      () => undefined,
    );
  };
  const navigation = (event: Electron.Event<{ isMainFrame: boolean }>) => {
    if (event.isMainFrame) void stop();
  };
  const lifecycle = () => void stop();
  options.contents.on("did-start-navigation", navigation);
  options.contents.on("destroyed", lifecycle);

  async function pick(
    token: number,
    input: { number: number; mode: AnnotationMode },
    operation: NativeOperation,
  ) {
    const signal = operation.signal;
    let armed = false;
    const selected = Promise.withResolvers<
      | { kind: "element"; target: { backendNodeId: number; sessionID?: string } }
      | { kind: "area"; viewport: BrowserSelection["bounds"] }
    >();
    void selected.promise.catch(() => undefined);
    const abort = (error: Error) => selected.reject(error);
    const onSignal = () => abort(new AnnotationCancelled("Annotation selection cancelled."));
    signal.addEventListener("abort", onSignal, { once: true });
    const checkCancelled = () => {
      const terminal = options.retired();
      if (terminal) throw terminal;
      if (signal.aborted) throw new AnnotationCancelled("Annotation selection cancelled.");
    };
    const offNode = options.cdp.on("Overlay.inspectNodeRequested", (event, sessionID) => {
      if (!armed) return;
      selected.resolve({
        kind: "element",
        target: { backendNodeId: event.backendNodeId, sessionID },
      });
    });
    const offArea = options.cdp.on("Overlay.screenshotRequested", ({ viewport }) => {
      if (!armed) return;
      selected.resolve({
        kind: "area",
        viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
      });
    });
    const offCancel = options.cdp.on("Overlay.inspectModeCanceled", () => {
      if (!armed) return;
      abort(new AnnotationCancelled("Annotation selection cancelled."));
    });
    const disarm = async () => {
      await options.cdp.send("Overlay.setInspectMode", {
        mode: "none",
        highlightConfig: HIGHLIGHT_CONFIG,
      });
      await options.cdp.send("Overlay.hideHighlight");
      armed = false;
    };
    try {
      checkCancelled();
      await options.ready();
      checkCancelled();
      await options.cdp.send("Overlay.enable");
      checkCancelled();
      await options.cdp.send("Overlay.setInspectMode", {
        mode: input.mode === "element" ? "searchForNode" : "captureAreaScreenshot",
        highlightConfig: HIGHLIGHT_CONFIG,
      });
      armed = true;
      checkCancelled();
      options.contents.focus();
      const armedTab = options.state();
      const target = await selected.promise;
      checkCancelled();
      await disarm();
      await settleFrame(options.cdp);
      verifyDocument(armedTab, options.state());
      if (target.kind === "area") {
        const selection: BrowserSelection = {
          frameUrl: armedTab.url,
          selector: "",
          tag: "area",
          text: "",
          role: "",
          label: "",
          bounds: target.viewport,
          topFrame: true,
        };
        const image = await options.capture(
          { number: input.number, mode: "area", markerBounds: target.viewport },
          signal,
        );
        checkCancelled();
        verifyDocument(armedTab, options.state());
        const body = await options.comment(target.viewport, signal);
        checkCancelled();
        if (body === undefined) return undefined;
        return {
          tab: armedTab,
          mode: input.mode,
          selection,
          image,
          body,
        };
      }
      const info = await options.element(target.target, signal);
      if (!info) throw new Error("Selected element is no longer available.");
      if (info.selection.topFrame && !info.visible)
        throw new Error("Selected element is no longer visible. Select again or capture an area.");
      const markerBounds = info.selection.topFrame ? info.selection.bounds : undefined;
      const image = await options.capture(
        { number: input.number, mode: "element", markerBounds },
        signal,
      );
      checkCancelled();
      const after = await options.element(target.target, signal).catch(() => undefined);
      if (!after) throw new Error("Page changed during annotation capture. Select again.");
      if (after.selection.frameUrl !== info.selection.frameUrl)
        throw new Error("Page changed during annotation capture. Select again.");
      if (info.selection.topFrame && !sameBounds(info.selection.bounds, after.selection.bounds))
        throw new Error("Page changed during annotation capture. Select again.");
      verifyDocument(armedTab, options.state());
      // Child-frame selections keep the pane editor: the popover anchors to the
      // top document and cannot follow a frame-local rectangle.
      const body = info.selection.topFrame
        ? await options.comment(info.selection.bounds, signal)
        : "";
      checkCancelled();
      if (body === undefined) return undefined;
      return {
        tab: armedTab,
        mode: input.mode,
        selection: info.selection,
        image,
        body,
      };
    } finally {
      // A final cleanup that hangs must not outlive the operation's drain budget.
      operation.drain();
      signal.removeEventListener("abort", onSignal);
      offNode();
      offArea();
      offCancel();
      if (armed && !options.retired()) {
        try {
          await disarm();
        } catch {
          options.retire(CLEANUP_FAILURE);
        }
      }
      if (active?.token === token) active = undefined;
    }
  }

  return {
    /** Resolves with the composited image, or `undefined` when the pick was cancelled. */
    start(input: { number: number; mode: AnnotationMode }, signal: AbortSignal) {
      if (active) throw new Error("Finish or cancel the current annotation selection first.");
      const token = ++nextToken;
      const operation = createNativeOperation(signal, () => options.retire(STOPPED_RESPONDING));
      const pending = pick(token, input, operation)
        .catch((error: unknown) => {
          if (error instanceof AnnotationCancelled) return undefined;
          throw error;
        })
        .finally(() => operation.finish());
      active = { token, operation, pending };
      return pending;
    },
    cancel: () => void stop(),
    stop,
    async dispose() {
      options.contents.off("did-start-navigation", navigation);
      options.contents.off("destroyed", lifecycle);
      await stop();
    },
  };
}

/** Best-effort wait for the compositor to drop the inspector highlight. */
async function settleFrame(cdp: Cdp) {
  await Promise.race([
    cdp
      .send("Runtime.evaluate", {
        expression:
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        awaitPromise: true,
        returnByValue: true,
      })
      .catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 250)),
  ]);
}

function verifyDocument(before: Browser.Tab, after: Browser.Tab) {
  if (before.url !== after.url || before.generation !== after.generation)
    throw new Error("Page changed during annotation capture. Select again.");
}

function sameBounds(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    Math.abs(left.x - right.x) <= MOVED_TOLERANCE &&
    Math.abs(left.y - right.y) <= MOVED_TOLERANCE &&
    Math.abs(left.width - right.width) <= MOVED_TOLERANCE &&
    Math.abs(left.height - right.height) <= MOVED_TOLERANCE
  );
}
