import { Browser } from "@opencode/plugin-browser/rpc";
import electron, { type BrowserWindow, type WebContents } from "electron";
import type { Protocol } from "devtools-protocol";
import { Schema } from "effect";
import { fileURLToPath } from "node:url";
import { createCdp, abortError, waitFor } from "./cdp.ts";
import { createNativeOperation, type NativeOperation } from "./operation.ts";
import { createBrowserFiles } from "./files.ts";
import {
  createAnnotationPicker,
  type AnnotationCaptureInput,
  type AnnotationElementInfo,
} from "./annotation.ts";
import { requestAnnotationComment } from "./annotation-comment.ts";
import {
  annotationCaptureScale,
  detectChannelOrder,
  drawAnnotationMarker,
  type ChannelOrder,
} from "./annotation-image.ts";
import {
  BROWSER_ANNOTATOR_CHANNEL,
  BrowserAnnotatorReply,
} from "../../../shared/browser-annotator.ts";
import { createDiagnostics } from "./diagnostics.ts";
import { createProfiling } from "./profiling.ts";
import type { BrowserNetwork } from "../network.ts";
import { destinationOrigin, normalizeURL } from "./policy.ts";

type Element = { backendID: number; frameID: string; sessionID?: string };
let nextRef = 0;
// Captures and downloads belong to the tab, not whichever document it now shows; navigate replaces it anyway.
const retainedOperations = new Set<Browser.Method>([
  "navigate",
  "files.list",
  "files.get",
  "trace.stop",
  "trace.analyze",
  "cpu.stop",
  "cpu.analyze",
  "heap.summary",
  "heap.query",
  "heap.object",
  "heap.compare",
]);
const boundsFunction =
  "function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }";

/** Runs against the selected node; page values are bounded here and re-validated by the shared schema. */
const annotationContext = String.raw`function() {
  const bounds = this.getBoundingClientRect();
  const path = [];
  let node = this;
  while (node && node.nodeType === 1 && path.length < 8) {
    const tag = node.localName;
    if (node.id) {
      path.unshift(tag + "#" + CSS.escape(node.id));
      break;
    }
    const parent = node.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((item) => item.localName === tag) : [];
    path.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")" : tag);
    node = parent;
  }
  return {
    frameUrl: (this.ownerDocument.URL || "").slice(0, 16384),
    selector: path.join(" > ").slice(0, 4096),
    tag: (this.localName || "").slice(0, 256),
    text: (this.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4096),
    role: (this.getAttribute("role") || "").slice(0, 256),
    label: (this.getAttribute("aria-label") || "").slice(0, 1024),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    topFrame: window === window.top,
  };
}`;
const AnnotationContext = Schema.Struct({
  frameUrl: Schema.String,
  selector: Schema.String,
  tag: Schema.String,
  text: Schema.String,
  role: Schema.String,
  label: Schema.String,
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  topFrame: Schema.Boolean,
});
const ANNOTATION_MAX_BYTES = 1_200_000;
const STOPPED_RESPONDING =
  "The browser tab stopped responding while cancelling an operation and was closed. Open the page again.";
/** Viewport rect shared by pointer-operation geometry and annotation composition. */
const ViewportRectSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
type ViewportRect = { x: number; y: number; width: number; height: number };
/** A one-pixel red PNG; identifies which bitmap channel holds red on this platform. */
const RED_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
let annotationOrder: ChannelOrder | undefined;
function annotationChannelOrder() {
  annotationOrder ??= detectChannelOrder(
    electron.nativeImage.createFromDataURL(RED_PIXEL_DATA_URL).toBitmap(),
  );
  return annotationOrder;
}
export type BrowserPage = ReturnType<typeof createBrowserPage>;

export function createBrowserPage(
  win: BrowserWindow,
  options: {
    id: Browser.TabID;
    partition: string;
    network: BrowserNetwork;
    publish: (error?: string) => void;
    fail: (reason?: string) => void;
    popup: (options: Electron.BrowserWindowConstructorOptions) => WebContents;
    popupOptions?: Electron.BrowserWindowConstructorOptions;
  },
) {
  const webPreferences = {
    partition: options.partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    devTools: false,
    backgroundThrottling: false,
    // The annotation popover is the only oc-ui code in a page; it is isolated
    // from page scripts and draws only its own closed shadow root.
    preload: fileURLToPath(new URL("../preload/browser-annotator.cjs", import.meta.url)),
    // Agent navigation, including in hidden tabs, must not take the user's keyboard focus.
    focusOnNavigation: false,
  };
  const view = new electron.WebContentsView({ ...options.popupOptions, webPreferences });
  const contents = view.webContents;
  const detachNetwork = options.network.attach(contents);
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5" && !input.meta && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      contents.reload();
      return;
    }
    if (input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return;
    const step =
      input.key === "=" || input.key === "+" || input.code === "NumpadAdd"
        ? 0.5
        : input.key === "-" || input.code === "NumpadSubtract"
          ? -0.5
          : 0;
    if (!step && input.key !== "0") return;
    event.preventDefault();
    contents.setZoomLevel(input.key === "0" ? 0 : contents.getZoomLevel() + step);
  });
  const cdp = createCdp(contents);
  const files = createBrowserFiles();
  const diagnostics = createDiagnostics(cdp);
  const profiling = createProfiling(contents, cdp, files);
  const refs = new Map<string, Element>();
  const sessions = new Map<string, string>();
  const parents = new Map<string, string>();
  const contexts = new Map<string, { id: number; sessionID?: string }>();
  const pendingOperations = new Map<Promise<Browser.Result>, NativeOperation>();
  const dialogs = new Set<() => void>();
  let dialog: { type: string; message: string; defaultValue: string } | null = null;
  let generation = 0;
  let closed = false;
  let fenced = false;
  let terminal: Error | undefined;
  const state = (): Browser.Tab => ({
    id: options.id,
    url: contents.getURL().slice(0, 16_384),
    title: contents.getTitle().slice(0, 2_048),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    generation,
  });
  const publish = () => {
    if (!closed && !terminal) options.publish();
  };
  /** Close the target before awaiting CDP-dependent cleanup, so callers settle. */
  const fence = (reason: Error) => {
    if (fenced) return;
    fenced = true;
    // A concurrent owner disposal must not mask the terminal reason.
    cdp.close(terminal ?? reason);
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
  };
  // Created before navigation handlers so cancelling a pick does not race a page reload.
  const annotation = createAnnotationPicker({
    contents,
    cdp,
    state,
    ready: () => ready,
    retired: () => terminal,
    retire,
    element: annotationElement,
    capture: annotationCapture,
    comment: annotationComment,
  });
  const reset = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
    if (!event.isMainFrame || event.isSameDocument) return;
    annotation.cancel();
    generation++;
    refs.clear();
    diagnostics.clear();
    publish();
  };
  contents.on("did-start-navigation", reset);
  contents.on("did-stop-loading", publish);
  contents.on("did-navigate-in-page", publish);
  contents.on("page-title-updated", publish);
  contents.on("render-process-gone", () => {
    if (!closed && !terminal) options.fail();
  });
  contents.debugger.on("detach", () => {
    if (!closed && !terminal) options.fail();
  });
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setDevicePermissionHandler(() => false);
  contents.session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  contents.on("content-bounds-updated", (event) => event.preventDefault());
  // Sub-frames keep Chromium's own rules so blob:/data: viewers and sandboxed previews still load.
  const guard = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (!event.isMainFrame || event.url === "about:blank" || destinationOrigin(event.url)) return;
    event.preventDefault();
    options.publish("ERR_BLOCKED_BY_CLIENT");
  };
  contents.on("will-frame-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) =>
    url === "about:blank" || destinationOrigin(url)
      ? {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences },
          createWindow: (popupOptions) => options.popup(popupOptions),
        }
      : { action: "deny" },
  );
  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) => {
    if (source !== contents) return;
    try {
      const file = files.add(item.getFilename(), item.getMimeType() || "application/octet-stream");
      item.setSavePath(file.path);
      item.on("updated", () => {
        file.bytes = item.getReceivedBytes();
        if (file.bytes > Browser.MAX_FILE_BYTES) item.cancel();
      });
      item.once("done", (_event, status) => {
        file.bytes = item.getReceivedBytes();
        file.state = status === "completed" ? "completed" : "failed";
      });
    } catch {
      item.cancel();
      options.publish("download_failed");
    }
  };
  contents.session.on("will-download", download);
  cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
    const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined;
    if (aux?.frameId && aux.isDefault) contexts.set(aux.frameId, { id: context.id, sessionID });
  });
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) => {
    contexts.forEach((context, key) => {
      if (context.id === executionContextId && context.sessionID === sessionID)
        contexts.delete(key);
    });
  });
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }, parentSessionID) => {
    if (targetInfo.type !== "iframe") return;
    const parentID =
      targetInfo.parentFrameId ??
      Array.from(sessions).find(([, id]) => id === parentSessionID)?.[0];
    if (parentID) parents.set(targetInfo.targetId, parentID);
    sessions.set(targetInfo.targetId, sessionId);
    void Promise.all([
      diagnostics.enable(sessionId),
      cdp.send("Page.enable", {}, sessionId),
      cdp.send(
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }, { exclude: true }],
        },
        sessionId,
      ),
    ]).catch(() => undefined);
  });
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    sessions.forEach((id, frameID) => {
      if (id === sessionId) {
        sessions.delete(frameID);
        parents.delete(frameID);
      }
    });
  });
  cdp.on("Page.javascriptDialogOpening", (event) => {
    dialog = {
      type: event.type,
      message: event.message.slice(0, Browser.MAX_TEXT),
      defaultValue: event.defaultPrompt ?? "",
    };
    dialogs.forEach((reject) => reject());
    publish();
  });
  cdp.on("Page.javascriptDialogClosed", () => {
    dialog = null;
    publish();
  });
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  view.setVisible(false);
  win.contentView.addChildView(view);
  const ready = Promise.all([
    files.ready,
    ...(options.popupOptions !== undefined ? [] : [contents.loadURL("about:blank")]),
    diagnostics.enable(),
    cdp.send("Page.enable"),
    cdp.send("DOM.enable"),
    cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }, { exclude: true }],
    }),
  ]).then(() => undefined);

  // Everything below this return is hoisted function declarations only; runtime
  // state and schema declarations must appear before it or they never initialize.
  return {
    view,
    contents,
    state,
    ready,
    annotation,
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      await ready;
      abortError(signal);
      if (closed)
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        );
      if (terminal) throw terminal;
      // A command owns the page while it runs; a pending element pick must not race its input.
      await annotation.stop();
      if (terminal) throw terminal;
      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        );
      if (
        command.generation !== undefined &&
        command.generation !== generation &&
        !retainedOperations.has(command.action.type)
      )
        throw new Error(
          "The document changed before this operation ran. Call browser.tabs.list({}) to check its current URL, then browser.snapshot({tabID}) for fresh refs. Reconsider the action before retrying on the new page.",
        );
      const modal = Promise.withResolvers<never>();
      const cancelled = Promise.withResolvers<never>();
      // The action underneath the race keeps running after a dialog wins it; it checks this
      // signal before each further step, so a validation alert on one field stops the rest.
      // A navigation is left alone: its beforeunload dialog is answered through browser.dialog
      // and the pending load then proceeds or not.
      // External cancellation drains: an abandoned action must settle or the page retires.
      // A dialog abandons the action without treating the page as terminal.
      const operation = createNativeOperation(signal, () => retire(STOPPED_RESPONDING));
      const cancel = () => {
        cancelled.reject(
          new Error(
            "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
          ),
        );
      };
      signal.addEventListener("abort", cancel, { once: true });
      const reject = () => {
        if (command.action.type !== "navigate") operation.abort();
        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        );
      };
      if (command.action.type !== "dialog") dialogs.add(reject);
      const pending = execute(command.action, command.files, operation.signal);
      pendingOperations.set(pending, operation);
      const finished = pending.then(
        (value) => {
          pendingOperations.delete(pending);
          operation.finish();
          return value;
        },
        (error: unknown) => {
          pendingOperations.delete(pending);
          operation.finish();
          throw error;
        },
      );
      try {
        return await Promise.race([finished, modal.promise, cancelled.promise]);
      } finally {
        signal.removeEventListener("abort", cancel);
        dialogs.delete(reject);
      }
    },
    async dispose() {
      if (closed) return;
      closed = true;
      // Fence the target first: CDP-dependent cleanup must not hold the WebContents open.
      fence(new Error("Browser tab was closed."));
      detachNetwork();
      contents.session.off("will-download", download);
      pendingOperations.forEach((operation) => operation.cancel());
      await annotation.dispose();
      await profiling.dispose();
      refs.clear();
      if (!win.isDestroyed()) win.contentView.removeChildView(view);
      await Promise.allSettled(pendingOperations.keys());
      await files.dispose();
    },
  };

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
  ): Promise<Browser.Result> {
    const result = (value: unknown, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value);
      if (JSON.stringify(json).length > 512_000)
        throw new Error(
          "Browser result exceeds 512000 JSON characters. Request fewer entries, reduce snapshot depth, or return only selected fields from the evaluation script. Repeating the same request will not reduce its output.",
        );
      return { value: json, files: attached };
    };
    switch (action.type) {
      case "navigate": {
        const url = normalizeURL(action.url);
        const cancel = () => contents.stop();
        signal.addEventListener("abort", cancel, { once: true });
        try {
          await contents.loadURL(url);
        } finally {
          signal.removeEventListener("abort", cancel);
        }
        abortError(signal);
        return result(state());
      }
      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back" && contents.navigationHistory.canGoBack())
          contents.navigationHistory.goBack();
        if (action.type === "forward" && contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward();
        if (action.type === "reload") contents.reload();
        if (action.type === "stop") contents.stop();
        if (action.type !== "stop") await waitFor(() => !contents.isLoading(), signal, 30_000);
        return result(state());
      }
      case "frames":
        return result({ tab: state(), frames: await frames() });
      case "snapshot":
      case "find":
        return result({ tab: state(), ...(await snapshot(action)) });
      case "evaluate": {
        const context = action.frameID ? contexts.get(action.frameID) : undefined;
        if (action.frameID && !context)
          throw new Error(
            "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID to target the main frame.",
          );
        const value = await cdp.send(
          "Runtime.evaluate",
          {
            expression: action.script,
            contextId: context?.id,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          },
          context?.sessionID,
        );
        if (value.exceptionDetails)
          throw new Error(
            `Page JavaScript threw an exception. Check the script and frameID; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
          );
        abortError(signal);
        return result({ tab: state(), value: value.result.value ?? null });
      }
      case "click":
        await click(
          target(action.ref),
          signal,
          action.button ?? "left",
          action.count ?? 1,
          action.modifiers,
        );
        break;
      case "hover":
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...(await point(target(action.ref), signal)),
        });
        break;
      case "drag": {
        const source = target(action.from);
        const destination = target(action.to);
        await point(destination, signal);
        const from = await point(source, signal);
        const box = await rect(destination);
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const html5 = await call(source, "function() { return this.draggable; }");
        let data: Protocol.Input.DragData | undefined;
        const off = cdp.on("Input.dragIntercepted", (event) => {
          data = event.data;
        });
        await cdp.send("Input.setInterceptDrags", { enabled: true });
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...from,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        try {
          for (let i = 1; i <= 10; i++) {
            abortError(signal);
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: from.x + ((to.x - from.x) * i) / 10,
              y: from.y + ((to.y - from.y) * i) / 10,
              button: "left",
              buttons: 1,
            });
          }
          if (html5) await waitFor(() => data !== undefined, signal, 2_000);
          if (data) {
            for (const type of ["dragEnter", "dragOver", "drop"])
              await cdp.send("Input.dispatchDragEvent", { type, ...to, data });
          }
        } finally {
          off();
          await cdp.send("Input.setInterceptDrags", { enabled: false });
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            ...to,
            button: "left",
            clickCount: 1,
          });
        }
        break;
      }
      case "fill":
        await fill(target(action.ref), action.text, signal);
        break;
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal);
          if (field.type === "text") await fill(target(field.ref), field.value, signal);
          if (field.type === "select") await select(target(field.ref), field.values);
          if (field.type === "check") await check(target(field.ref), field.checked, signal);
        }
        break;
      case "select":
        await select(target(action.ref), action.values);
        break;
      case "check":
        await check(target(action.ref), action.checked, signal);
        break;
      case "press":
        await key(action.key);
        break;
      case "scroll": {
        const bounds = view.getBounds();
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: bounds.width / 2,
          y: bounds.height / 2,
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        });
        break;
      }
      case "wait": {
        if (action.condition !== "load" && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          );
        await waitFor(
          async () => {
            if (action.condition === "load") return !contents.isLoading();
            const context = action.frameID ? contexts.get(action.frameID) : undefined;
            if (action.frameID && !context)
              throw new Error(
                "Frame context is unavailable. Call browser.frames({tabID}) and use a frameID from this tab.",
              );
            const value = await cdp.send(
              "Runtime.evaluate",
              {
                expression: `document.body?.innerText.includes(${JSON.stringify(action.text)}) ?? false`,
                returnByValue: true,
                contextId: context?.id,
              },
              context?.sessionID,
            );
            return Boolean(value.result.value) === (action.condition === "text");
          },
          signal,
          action.timeoutMs,
        ).catch((error) => {
          if (signal.aborted) throw error;
          throw new Error(
            `browser.wait failed for condition ${JSON.stringify(action.condition)} (timeoutMs: ${action.timeoutMs ?? 10_000}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        break;
      }
      case "screenshot": {
        if (action.ref && action.fullPage)
          throw new Error(
            "Choose either ref for an element screenshot or fullPage:true for the whole page. Remove the other argument before retrying.",
          );
        await waitFor(
          () => view.getVisible() && win.isVisible() && !win.isMinimized(),
          signal,
          3_000,
        ).catch((error) => {
          if (signal.aborted) throw error;
          throw new Error(
            "Screenshot needs a visible tab. Call browser.tabs.focus and keep its desktop window visible.",
          );
        });
        const element = action.ref ? await rect(target(action.ref), signal) : undefined;
        const metrics = await cdp.send("Page.getLayoutMetrics");
        const bounds = element
          ? {
              ...element,
              x: element.x + metrics.cssVisualViewport.pageX,
              y: element.y + metrics.cssVisualViewport.pageY,
            }
          : action.fullPage
            ? metrics.cssContentSize
            : {
                x: metrics.cssVisualViewport.pageX,
                y: metrics.cssVisualViewport.pageY,
                width: metrics.cssVisualViewport.clientWidth,
                height: metrics.cssVisualViewport.clientHeight,
              };
        const pixelRatio =
          contents.getZoomFactor() *
          electron.screen.getDisplayMatching(win.getBounds()).scaleFactor;
        const scale = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio));
        if (bounds.width <= 0 || bounds.height <= 0)
          throw new Error(
            "Element or page has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport.",
          );
        if (bounds.width * bounds.height * (scale * pixelRatio) ** 2 > 16_000_000)
          throw new Error(
            "Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.",
          );
        const format = action.format ?? "png";
        const capture = await cdp.send("Page.captureScreenshot", {
          format,
          quality: format === "png" ? undefined : (action.quality ?? 80),
          captureBeyondViewport: true,
          clip: { ...bounds, scale },
        });
        const id = await files.save(
          `screenshot.${format}`,
          `image/${format}`,
          Buffer.from(capture.data, "base64"),
        );
        return result({ tab: state() }, [await files.transfer(id)]);
      }
      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            );
          await cdp.send("Page.handleJavaScriptDialog", {
            accept: action.action === "accept",
            promptText: action.promptText,
          });
          dialog = null;
        }
        return result({ tab: state(), dialog });
      }
      case "files.upload":
      case "files.drop": {
        if (!transfers.length)
          throw new Error(
            "Upload command has no file bytes. Supply server-local paths to browser.files.upload/drop; do not call the desktop RPC directly with desktop paths. If paths were supplied, report a client/server transfer mismatch.",
          );
        const local = await Promise.all(
          transfers.map(
            async (file) => files.get(await files.save(file.name, file.mime, file.data)).path,
          ),
        );
        const element = target(action.ref);
        if (action.type === "files.upload")
          await cdp.send(
            "DOM.setFileInputFiles",
            { files: local, backendNodeId: element.backendID },
            element.sessionID,
          );
        if (action.type === "files.drop") {
          const position = await point(element, signal);
          for (const type of ["dragEnter", "dragOver", "drop"])
            await cdp.send("Input.dispatchDragEvent", {
              type,
              ...position,
              data: { items: [], files: local, dragOperationsMask: 1 },
            });
        }
        break;
      }
      case "files.list":
        return result({ tab: state(), files: files.list() });
      case "files.get":
        return result({ tab: state() }, [await files.transfer(action.fileID)]);
      case "console":
        return result({ tab: state(), ...diagnostics.console(action) });
      case "network.list":
        return result({ tab: state(), ...diagnostics.list(action) });
      case "network.get":
        return result({ tab: state(), ...(await diagnostics.get(action)) });
      case "trace.start":
        await profiling.startTrace(action.durationMs);
        return result({ tab: state(), recording: true });
      case "trace.stop": {
        const value = await profiling.stopTrace();
        return result(
          { tab: state(), durationMs: value.durationMs, incomplete: value.incomplete },
          [await files.transfer(value.id)],
        );
      }
      case "cpu.start":
        await profiling.startCpu();
        return result({ tab: state(), recording: true });
      case "cpu.stop": {
        const value = await profiling.stopCpu();
        return result({ tab: state(), durationMs: value.durationMs }, [
          await files.transfer(value.id),
        ]);
      }
      case "heap.snapshot":
        return result({ tab: state() }, [await files.transfer(await profiling.heap())]);
      case "trace.analyze":
      case "cpu.analyze":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
        return result({ tab: state(), ...(await profiling.analyze(action)) });
      case "lighthouse": {
        const { audit } = await import("./lighthouse.ts");
        const report = await audit(contents, files, cdp);
        return result(
          { tab: state(), scores: report.scores, failures: report.failures },
          await Promise.all(report.files.map((id) => files.transfer(id))),
        );
      }
      default:
        throw new Error(
          "This operation was routed to a page instead of the tab manager. Report a desktop/plugin routing mismatch; changing tab IDs or repeating the operation will not fix it.",
        );
    }
    abortError(signal);
    return result(state());
  }

  function target(ref: Browser.Ref): Element {
    const value = refs.get(ref.replace(/^@/, ""));
    if (!value)
      throw new Error(
        "Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.",
      );
    return value;
  }

  function frameIDForSession(sessionID: string) {
    for (const [frameID, session] of sessions) if (session === sessionID) return frameID;
    return undefined;
  }

  /** Terminal failure: notify the native owner, fence the connection, and close the page. */
  function retire(reason: string) {
    if (terminal) return;
    const error = new Error(reason);
    terminal = error;
    options.fail(reason);
    fence(error);
  }

  async function annotationElement(
    target: { backendNodeId: number; sessionID?: string },
    signal: AbortSignal,
  ): Promise<AnnotationElementInfo> {
    abortError(signal);
    const resolved = await cdp
      .send("DOM.resolveNode", { backendNodeId: target.backendNodeId }, target.sessionID)
      .catch(() => undefined);
    const objectId = resolved?.object.objectId;
    if (!objectId) throw new Error("Selected element is no longer available.");
    let raw: unknown;
    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: annotationContext, returnByValue: true },
        target.sessionID,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      raw = result.result.value;
    } finally {
      await cdp
        .send("Runtime.releaseObject", { objectId }, target.sessionID)
        .catch(() => undefined);
    }
    const value = Schema.decodeUnknownSync(AnnotationContext)(raw);
    const local = { x: value.x, y: value.y, width: value.width, height: value.height };
    let topFrame = value.topFrame;
    let bounds = local;
    if (!topFrame && target.sessionID) {
      const frameID = frameIDForSession(target.sessionID);
      if (frameID) {
        try {
          bounds = await composeRect(frameID, { ...local });
          topFrame = true;
        } catch {
          topFrame = false;
        }
      }
    }
    const viewport = await cdp
      .send("Page.getLayoutMetrics")
      .then((metrics) => metrics.cssLayoutViewport)
      .catch(() => undefined);
    const visible =
      !topFrame ||
      !viewport ||
      (bounds.x < viewport.clientWidth &&
        bounds.y < viewport.clientHeight &&
        bounds.x + bounds.width > 0 &&
        bounds.y + bounds.height > 0);
    return {
      selection: {
        frameUrl: value.frameUrl,
        selector: value.selector,
        tag: value.tag,
        text: value.text,
        role: value.role,
        label: value.label,
        bounds,
        topFrame,
      },
      visible,
    };
  }

  async function annotationCapture(
    input: AnnotationCaptureInput,
    signal: AbortSignal,
  ): Promise<Browser.File> {
    abortError(signal);
    await waitFor(
      () => view.getVisible() && win.isVisible() && !win.isMinimized(),
      signal,
      3_000,
    ).catch((error) => {
      if (signal.aborted) throw error;
      throw new Error(
        "Screenshot needs a visible tab. Focus the browser tab and keep its desktop window visible.",
      );
    });
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const viewport = metrics.cssVisualViewport;
    const bounds = {
      x: viewport.pageX,
      y: viewport.pageY,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
    if (bounds.width <= 0 || bounds.height <= 0)
      throw new Error("The browser viewport has no visible area to capture.");
    const pixelRatio =
      contents.getZoomFactor() * electron.screen.getDisplayMatching(win.getBounds()).scaleFactor;
    // Capture at the display's real resolution, with no width cap. The pixel
    // budget only protects main from an unbounded bitmap on very large
    // displays, and it scales the capture instead of refusing it.
    const { clipScale, imageScale } = annotationCaptureScale(
      bounds.width,
      bounds.height,
      pixelRatio,
    );
    const capture = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...bounds, scale: clipScale },
    });
    abortError(signal);
    const source = electron.nativeImage.createFromBuffer(Buffer.from(capture.data, "base64"));
    const size = source.getSize();
    if (size.width <= 0 || size.height <= 0)
      throw new Error("Annotation screenshot could not be decoded.");
    const bitmap = source.toBitmap();
    if (input.markerBounds)
      drawAnnotationMarker(
        bitmap,
        size.width,
        size.height,
        { mode: input.mode, bounds: input.markerBounds, number: input.number, scale: imageScale },
        annotationChannelOrder(),
      );
    const composed = electron.nativeImage.createFromBitmap(bitmap, {
      width: size.width,
      height: size.height,
      scaleFactor: 1,
    });
    let data = composed.toPNG();
    let mime = "image/png";
    let name = `annotation-${input.number}.png`;
    if (data.length > ANNOTATION_MAX_BYTES) {
      // JPEG at high quality only wins when PNG is large (noisy or photographic
      // pages); flat UI stays on the lossless PNG path.
      data = composed.toJPEG(90);
      mime = "image/jpeg";
      name = `annotation-${input.number}.jpg`;
    }
    // The IPC event carries typed bytes; an oversized capture would be dropped by
    // schema decoding, so fail here where the user gets a message.
    if (data.length > Browser.MAX_FILE_BYTES)
      throw new Error(
        "The annotated screenshot is too large to attach. Select a smaller area and try again.",
      );
    return {
      // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- The pinned Effect RC has no UUID API; use platform correlation IDs.
      id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
      name,
      mime,
      data,
    };
  }

  async function annotationComment(
    anchor: { x: number; y: number; width: number; height: number },
    signal: AbortSignal,
  ) {
    return requestAnnotationComment(
      {
        send: (message) => contents.send(BROWSER_ANNOTATOR_CHANNEL, message),
        onReply: (listener) => {
          const receive = (event: Electron.IpcMainEvent, channel: string, ...args: unknown[]) => {
            if (channel !== BROWSER_ANNOTATOR_CHANNEL) return;
            // Only the top frame's preload may answer for this interaction.
            if (event.senderFrame !== contents.mainFrame) return;
            let reply: typeof BrowserAnnotatorReply.Type;
            try {
              reply = Schema.decodeUnknownSync(BrowserAnnotatorReply)(args[0]);
            } catch {
              // A malformed or foreign message is ignored rather than escaping the picker.
              return;
            }
            listener(reply);
          };
          contents.on("ipc-message", receive);
          return () => contents.off("ipc-message", receive);
        },
        focus: () => contents.focus(),
      },
      anchor,
      signal,
    );
  }

  async function frames() {
    const root = await cdp.send("Page.getFrameTree");
    const result: { id: string; parentID?: string; url: string; name: string }[] = [];
    const walk = (tree: Protocol.Page.FrameTree, parentID?: string) => {
      if (!result.some((frame) => frame.id === tree.frame.id))
        result.push({
          id: tree.frame.id,
          ...(tree.frame.parentId || parentID ? { parentID: tree.frame.parentId ?? parentID } : {}),
          url: tree.frame.url,
          name: tree.frame.name ?? "",
        });
      tree.childFrames?.forEach((child) => walk(child, tree.frame.id));
    };
    walk(root.frameTree);
    const children = await Promise.all(
      Array.from(sessions, async ([id, sessionID]) => ({
        id,
        tree: await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined),
      })),
    );
    children.forEach(({ id, tree }) => {
      if (tree) walk(tree.frameTree, parents.get(id) ?? root.frameTree.frame.id);
    });
    return result;
  }

  async function call(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const object = await cdp.send(
      "DOM.resolveNode",
      { backendNodeId: element.backendID },
      element.sessionID,
    );
    const objectId = object.object.objectId;
    if (!objectId)
      throw new Error(
        "Element is no longer available. Call browser.snapshot({tabID}) and use a fresh ref; the page may have replaced the element.",
      );
    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration,
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        element.sessionID,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      return result.result.value as unknown;
    } finally {
      await cdp
        .send("Runtime.releaseObject", { objectId }, element.sessionID)
        .catch(() => undefined);
    }
  }

  async function localRect(element: Element, functionDeclaration = boundsFunction) {
    return Schema.decodeUnknownSync(ViewportRectSchema)(await call(element, functionDeclaration));
  }

  /** Composes a frame-local rect into top-viewport coordinates. */
  async function composeRect(frameID: string, source: ViewportRect): Promise<ViewportRect> {
    const value = { ...source };
    const tree = await frames();
    let frame = tree.find((item) => item.id === frameID);
    while (frame?.parentID) {
      const parent = { frameID: frame.parentID, sessionID: sessionFor(frame.parentID, tree) };
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, parent.sessionID);
      // A CSS transform on the iframe scales its content box; the child's own coordinates are unscaled.
      const box = Schema.decodeUnknownSync(
        Schema.Struct({
          ...ViewportRectSchema.fields,
          scaleX: Schema.Finite,
          scaleY: Schema.Finite,
        }),
      )(
        await call(
          { backendID: owner.backendNodeId, ...parent },
          "function() { const r = this.getBoundingClientRect(); const sx = this.offsetWidth ? r.width / this.offsetWidth : 1; const sy = this.offsetHeight ? r.height / this.offsetHeight : 1; return {x:r.x+this.clientLeft*sx,y:r.y+this.clientTop*sy,width:r.width,height:r.height,scaleX:sx,scaleY:sy}; }",
        ),
      );
      value.x = box.x + value.x * box.scaleX;
      value.y = box.y + value.y * box.scaleY;
      value.width *= box.scaleX;
      value.height *= box.scaleY;
      frame = tree.find((item) => item.id === frame?.parentID);
    }
    return value;
  }

  async function rect(element: Element, signal?: AbortSignal) {
    if (signal) {
      await cdp.send(
        "DOM.scrollIntoViewIfNeeded",
        { backendNodeId: element.backendID },
        element.sessionID,
      );
      // Force a compositor update after scrolling. requestAnimationFrame can
      // stall in a hidden WebContentsView, even with background throttling off.
      // A newly shown view may not have a compositor surface yet. Only retry this
      // read; pointer input below must never be replayed after an uncertain result.
      await waitFor(
        async () => {
          try {
            await contents.capturePage(undefined, { stayHidden: false, stayAwake: true });
            return true;
          } catch (error) {
            if (error instanceof Error && error.message.includes("UnknownVizError")) return false;
            throw error;
          }
        },
        signal,
        3_000,
      );
      abortError(signal);
    }
    return composeRect(element.frameID, await localRect(element));
  }

  // Same-process child frames have no CDP target of their own; the nearest ancestor with one owns them.
  function sessionFor(frameID: string, tree: { id: string; parentID?: string }[]) {
    let id: string | undefined = frameID;
    while (id && !sessions.has(id)) id = tree.find((frame) => frame.id === id)?.parentID;
    return id ? sessions.get(id) : undefined;
  }

  async function point(element: Element, signal: AbortSignal) {
    const box = await rect(element, signal);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async function click(
    element: Element,
    signal: AbortSignal,
    button = "left",
    count = 1,
    modifiers: readonly string[] = [],
  ) {
    const position = await point(element, signal);
    const flags = modifiers.reduce(
      (mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0),
      0,
    );
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...position,
      modifiers: flags,
    });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...position,
        button,
        clickCount,
        modifiers: flags,
      });
    }
  }

  async function fill(element: Element, value: string, signal: AbortSignal) {
    const kind = await call(
      element,
      "function() { if (this.disabled || this.readOnly) return; if (this instanceof HTMLTextAreaElement || this.isContentEditable) return 'text'; if (!(this instanceof HTMLInputElement)) return; if (['date','time','datetime-local','month','week'].includes(this.type)) return 'structured'; if (!['file','checkbox','radio','button','submit','reset','image','hidden','range','color'].includes(this.type)) return 'text'; }",
    );
    if (!kind)
      throw new Error(
        "Target is not an enabled editable text field. Take a fresh snapshot and choose a textbox; use browser.select for dropdowns, browser.check for checkboxes/radios, or browser.files.upload for file inputs.",
      );
    // Keyboard input cannot compose a date or time control's value; Chromium clears a malformed one.
    if (kind === "structured") {
      await call(
        element,
        "function(value) { const previous = this.value; this.focus(); this.value = value; if (this.value !== value) { this.value = previous; throw new Error('The ' + this.type + ' input rejected this value and keeps its previous one. Use its required format, for example 2026-09-07 for date, 14:45 for time, 2026-09-07T14:45 for datetime-local, 2026-09 for month, or 2026-W37 for week.'); } this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }",
        [value],
      );
      return;
    }
    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, element.sessionID);
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal);
    await key(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await key("Backspace");
    abortError(signal);
    await cdp.send("Input.insertText", { text: value });
  }

  async function select(element: Element, values: readonly string[]) {
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    );
  }

  async function check(element: Element, checked: boolean, signal: AbortSignal) {
    const current = await call(
      element,
      "function(checked) { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.'); if (this.type === 'radio' && this.checked && !checked) throw new Error('A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.'); return this.checked; }",
      [checked],
    );
    if (current !== checked) await click(element, signal);
    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error(
        "The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.",
      );
  }

  async function key(chord: string) {
    if (!chord)
      throw new Error(
        "A key is required. Use a named key such as Enter or ArrowDown, a single character, or a chord such as Control+A.",
      );
    const parts = (chord.endsWith("+") ? chord.slice(0, -1) : chord).split("+");
    const key = parts.pop() || "+";
    const modifiers = parts.reduce((mask, key) => {
      const bit = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key];
      if (!bit)
        throw new Error(
          `Unknown key modifier ${JSON.stringify(key)}. Supported modifiers are Alt, Control, Meta, and Shift; for example Control+A. Use Meta for macOS command shortcuts.`,
        );
      return mask | bit;
    }, 0);
    const codes: Record<string, number> = {
      Enter: 13,
      Tab: 9,
      Escape: 27,
      Backspace: 8,
      Delete: 46,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      PageUp: 33,
      PageDown: 34,
      Home: 36,
      End: 35,
      Space: 32,
    };
    const code =
      codes[key] ??
      (key.length === 1
        ? key.toUpperCase().charCodeAt(0)
        : /^F([1-9]|1[0-2])$/.test(key)
          ? 111 + Number(key.slice(1))
          : undefined);
    if (code === undefined)
      throw new Error(
        `Unknown key ${JSON.stringify(key)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character. Use browser.fill for text.`,
      );
    // Named keys need their character data too: Enter submits forms and inserts newlines only with "\r".
    const text =
      key === "Enter" ? "\r" : key === "Space" ? " " : key.length === 1 ? key : undefined;
    const params = {
      key: key === "Space" ? " " : key,
      windowsVirtualKeyCode: code,
      modifiers,
      ...(text !== undefined && !(modifiers & 6) ? { text } : {}),
    };
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  }

  async function snapshot(action: Extract<Browser.Action, { type: "snapshot" | "find" }>) {
    const tree = await frames();
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined;
    const frameID = selected?.frameID ?? action.frameID ?? tree[0]?.id;
    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new Error(
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      );
    const sessionID = sessionFor(frameID, tree);
    const depth = action.type === "snapshot" ? (action.depth ?? 8) : 8;
    const ax = await cdp.send(
      "Accessibility.getFullAXTree",
      { frameId: frameID, depth },
      sessionID,
    );
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]));
    const root = selected
      ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID)
      : ax.nodes[0];
    if (!root)
      throw new Error(
        "Element is absent from this frame's accessibility snapshot. Retry browser.snapshot with the same tabID and no ref to refresh the frame, then choose a returned ref.",
      );
    refs.clear();
    const lines: string[] = [];
    let truncated = false;
    const walk = async (node: Protocol.Accessibility.AXNode, level: number): Promise<void> => {
      if (level > depth || lines.length >= 500) {
        truncated = true;
        return;
      }
      const role = String(node.role?.value ?? "node")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40);
      const properties = new Map(
        node.properties?.map((property) => [property.name, property.value.value]) ?? [],
      );
      if (!node.ignored) {
        const actionable =
          role !== "RootWebArea" &&
          (properties.get("focusable") ||
            /^(button|link|textbox|combobox|checkbox|radio|option)$/.test(role));
        const ref = actionable && node.backendDOMNodeId ? `e${++nextRef}` : "";
        const element = node.backendDOMNodeId
          ? { backendID: node.backendDOMNodeId, frameID, sessionID }
          : undefined;
        if (ref && element) refs.set(ref, element);
        const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((name) =>
          properties.has(name) ? [`${name}=${properties.get(name)}`] : [],
        );
        const box =
          action.type === "snapshot" && action.boxes && ref && element
            ? await rect(element).catch(() => undefined)
            : undefined;
        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(
            String(node.name?.value ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 300),
          )} ${flags.join(" ")}${box ? ` box=${JSON.stringify(box)}` : ""}`,
        );
      }
      if (["textbox", "searchbox"].includes(role) || properties.get("editable")) return;
      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID);
        if (child) await walk(child, level + 1);
      }
    };
    await walk(root, 0);
    const content = (
      action.type === "find"
        ? lines.filter((line) => line.toLowerCase().includes(action.text.toLowerCase()))
        : lines
    ).join("\n");
    return {
      content: content.slice(0, Browser.MAX_TEXT),
      truncated: truncated || content.length > Browser.MAX_TEXT,
    };
  }
}
