import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodePath } from "@effect/platform-node";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from "electron";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";

import { BrowserHost } from "./browser/host.ts";
import { resolveDevProfiling } from "./dev-profiling.ts";
import { BROWSER_CHANNELS, BrowserRequest } from "../shared/browser-api.ts";

import type { SaveTargetInput } from "../shared/desktop-api.ts";
import { IPC_CHANNELS, parseOpenExternalUrl, parseSaveTargetInput } from "../shared/desktop-api.ts";
import { LocalOpenCode, LocalOpenCodeUnavailableError } from "./local-opencode.ts";
import { settingsLayer, Settings } from "./settings.ts";
import { settingsFileSystemLayer } from "./settings-file-system.ts";
import { createAppQuitHandler, settleSettingsIpc } from "./shutdown.ts";
import { resolveSessionDataPath, resolveUserDataPath } from "./user-data-path.ts";

const RENDERER_SCHEME = "oc";
const RENDERER_HOST = "renderer";
const APP_NAME = "Ocui";

// Raw development launches otherwise inherit Electron's shared profile. Give
// this app the same isolated identity and Chromium state it will have packaged.
app.setName(APP_NAME);
const appUserData = resolveUserDataPath(join(app.getPath("appData"), APP_NAME), process.argv);
const appSessionData = resolveSessionDataPath(appUserData);
mkdirSync(appSessionData, { recursive: true });
app.setPath("userData", appUserData);
app.setPath("sessionData", appSessionData);

// Development only: expose localhost profiling attach points. The renderer is
// reachable through the Chrome DevTools Protocol, the main process through the
// V8 inspector (electron-vite forwards V8_INSPECTOR_PORT), and the built-in
// OpenCode child through its own inspector. Automatic defaults require a real
// development launch; an explicit port variable opts in elsewhere. A packaged
// app enables none of this, and an empty port variable disables one.
const profilingPorts = resolveDevProfiling({
  isPackaged: app.isPackaged,
  developmentUrl: process.env.ELECTRON_RENDERER_URL,
  remoteDebuggingPort: process.env.REMOTE_DEBUGGING_PORT,
  openCodeInspectorPort: process.env.OCUI_OPENCODE_INSPECTOR_PORT,
  hasRemoteDebuggingSwitch: app.commandLine.hasSwitch("remote-debugging-port"),
});
if (profilingPorts.remoteDebuggingPort !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-port", profilingPorts.remoteDebuggingPort);
}

// Must run before app.ready so Chromium knows this is a secure, standard origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

type DesktopRuntime = ManagedRuntime.ManagedRuntime<Settings | LocalOpenCode | BrowserHost, never>;

let mainWindow: BrowserWindow | undefined;
let desktopRuntime: DesktopRuntime | undefined;
let removeIpcHandlers: (() => void) | undefined;
let removeLocalOpenCodeUnavailableListener: (() => void) | undefined;
let rendererProtocolInstalled = false;
const pendingIpc = new Set<Promise<unknown>>();

const quitHandler = createAppQuitHandler({
  localOpenCode: Effect.suspend(() =>
    desktopRuntime === undefined
      ? Effect.void
      : Effect.map(desktopRuntime.contextEffect, Context.get(LocalOpenCode)),
  ),
  // Omitting a BrowserWindow makes this an app-modal native dialog.
  showMessageBox: (options) => dialog.showMessageBox(options),
  cleanup: Effect.gen(function* () {
    // Keep handlers and settings alive until the renderer can no longer make
    // requests and every already accepted request has settled.
    mainWindow?.destroy();
    mainWindow = undefined;
    const runtime = desktopRuntime;
    yield* settleSettingsIpc(
      runtime === undefined
        ? Effect.void
        : Effect.flatMap(
            runtime.contextEffect,
            (context) => Context.get(context, Settings).shutdown,
          ),
      pendingIpc,
    );
    removeIpcHandlers?.();
    removeLocalOpenCodeUnavailableListener?.();
    removeLocalOpenCodeUnavailableListener = undefined;
    desktopRuntime = undefined;
    if (runtime !== undefined) yield* runtime.disposeEffect;
  }),
  quit: () => app.quit(),
});

type DesktopRuntimeEnvironment = {
  readonly rendererUrl: string | undefined;
  readonly workerPath: string;
};

const resolveDesktopRuntimeEnvironment = (): DesktopRuntimeEnvironment => {
  if (app.isPackaged) {
    return {
      rendererUrl: undefined,
      workerPath: join(process.resourcesPath, "opencode-runtime/opencode-worker.mjs"),
    };
  }
  return {
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    workerPath: fileURLToPath(new URL("../opencode-runtime/opencode-worker.mjs", import.meta.url)),
  };
};

/** Keeps accepted IPC work observable to shutdown until it settles. */
const trackPending = <A>(result: Promise<A>): Promise<A> => {
  pendingIpc.add(result);
  void result.then(
    () => pendingIpc.delete(result),
    () => pendingIpc.delete(result),
  );
  return result;
};

const runIpc = <A, E>(
  operation: Effect.Effect<A, E, Settings | LocalOpenCode | BrowserHost>,
): Promise<A> => {
  if (desktopRuntime === undefined) {
    return Promise.reject(new Error("Desktop services are not ready"));
  }
  return trackPending(desktopRuntime.runPromise(operation));
};

const assertTrustedIpcSender = (event: IpcMainInvokeEvent): void => {
  if (
    mainWindow === undefined ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Untrusted IPC sender");
  }
};

const installIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.targetLoad, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("target.load does not accept arguments"));
    }
    return runIpc(Effect.flatMap(Settings, (service) => service.load));
  });

  ipcMain.handle(IPC_CHANNELS.targetSave, (event, rawInput) => {
    assertTrustedIpcSender(event);
    let input: SaveTargetInput;
    try {
      input = parseSaveTargetInput(rawInput);
    } catch {
      return Promise.reject(new TypeError("invalid OpenCode target"));
    }

    return runIpc(Effect.flatMap(Settings, (service) => service.save(input)));
  });

  ipcMain.handle(IPC_CHANNELS.targetClear, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("target.clear does not accept arguments"));
    }
    return runIpc(Effect.flatMap(Settings, (service) => service.clear));
  });

  ipcMain.handle(IPC_CHANNELS.localOpenCodeConnect, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("localOpenCode.connect does not accept arguments"));
    }
    if (quitHandler.isQuitting()) {
      return { status: "failed" as const, message: "Ocui is closing." };
    }
    if (desktopRuntime === undefined) {
      return { status: "failed" as const, message: "Desktop services are not ready." };
    }
    return runIpc(
      Effect.flatMap(LocalOpenCode, (service) => service.connect).pipe(
        Effect.map((connection) => ({ status: "connected" as const, connection })),
        Effect.catchTag("LocalOpenCodeUnavailableError", (error) =>
          Effect.succeed({ status: "failed" as const, message: error.message }),
        ),
        Effect.catchDefect(() =>
          Effect.succeed({
            status: "failed" as const,
            message: LocalOpenCodeUnavailableError.fromReason("start-failed").message,
          }),
        ),
      ),
    );
  });

  ipcMain.handle(IPC_CHANNELS.openExternal, (event, rawUrl) => {
    assertTrustedIpcSender(event);
    if (quitHandler.isQuitting()) {
      return Promise.reject(new Error("Ocui is closing."));
    }
    let url: string;
    try {
      url = parseOpenExternalUrl(rawUrl).href;
    } catch {
      return Promise.reject(new TypeError("invalid external URL"));
    }
    // The OS handoff is not cancellable; keep it owned until it settles.
    return trackPending(shell.openExternal(url));
  });

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC input is decoded before dispatch.
  ipcMain.handle(BROWSER_CHANNELS.request, (event, raw: unknown) => {
    assertTrustedIpcSender(event);
    const input = Schema.decodeUnknownSync(BrowserRequest)(raw, { onExcessProperty: "error" });
    const win = mainWindow!;
    if (input._tag === "attach" && quitHandler.isQuitting()) throw new Error("Ocui is closing.");
    return runIpc(
      Effect.gen(function* () {
        const host = yield* BrowserHost;
        yield* BrowserRequest.match(input, {
          attach: (value) =>
            host.attach(win, value, (message) => {
              if (!win.isDestroyed() && !win.webContents.isDestroyed())
                win.webContents.send(BROWSER_CHANNELS.event, message);
            }),
          detach: (value) => host.detach(win, value.bindingID),
          command: (value) => host.command(win, value.bindingID, value.action),
          layout: (value) => host.layout(win, value),
          annotationStart: (value) => host.annotate(win, value),
          annotationCancel: (value) => host.annotationCancel(win, value),
        });
      }),
    );
  });

  removeIpcHandlers = () => {
    for (const channel of Object.values(BROWSER_CHANNELS)) ipcMain.removeHandler(channel);
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
    removeIpcHandlers = undefined;
  };
};

const forwardLocalOpenCodeUnavailable = (): void => {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.localOpenCodeUnavailable);
};

const isRendererUrl = (value: string, developmentOrigin: string | undefined): boolean => {
  try {
    const url = new URL(value);
    if (
      url.protocol === `${RENDERER_SCHEME}:` &&
      url.hostname === RENDERER_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    ) {
      return true;
    }
    return developmentOrigin !== undefined && url.origin === developmentOrigin;
  } catch {
    return false;
  }
};

const installRendererProtocol = async (rendererRoot: string): Promise<void> => {
  const root = await realpath(rendererRoot).catch(() => resolve(rendererRoot));

  protocol.handle(RENDERER_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (
      request.method !== "GET" ||
      requestUrl.hostname !== RENDERER_HOST ||
      requestUrl.port !== "" ||
      requestUrl.username !== "" ||
      requestUrl.password !== ""
    ) {
      return new Response("Not found", { status: 404 });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (pathname.includes("\0")) {
      return new Response("Bad request", { status: 400 });
    }

    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const candidate = resolve(root, `.${normalize(requestedPath)}`);
    const candidateRelative = relative(root, candidate);
    if (candidateRelative.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    // Resolve symlinks too, so an asset cannot escape the packaged renderer directory.
    const canonicalCandidate = await realpath(candidate).catch(() => undefined);
    if (canonicalCandidate === undefined) {
      return new Response("Not found", { status: 404 });
    }
    const canonicalRelative = relative(root, canonicalCandidate);
    if (canonicalRelative.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(canonicalCandidate).toString());
  });
};

const configurePermissions = (): void => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
};

const createMainWindow = async (): Promise<void> => {
  const { rendererUrl: developmentUrl } = resolveDesktopRuntimeEnvironment();
  const developmentOrigin =
    developmentUrl === undefined ? undefined : new URL(developmentUrl).origin;

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1_280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (process.platform === "darwin") {
    windowOptions.titleBarStyle = "hiddenInset";
  }
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isRendererUrl(url, developmentOrigin)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isRendererUrl(url, developmentOrigin)) {
      event.preventDefault();
    }
  });

  if (developmentUrl !== undefined) {
    await mainWindow.loadURL(developmentUrl);
    return;
  }

  const rendererRoot = fileURLToPath(new URL("../renderer", import.meta.url));
  if (!rendererProtocolInstalled) {
    await installRendererProtocol(rendererRoot);
    rendererProtocolInstalled = true;
  }
  await mainWindow.loadURL(`${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`);
};

const start = async (): Promise<void> => {
  await app.whenReady();
  if (quitHandler.isQuitting()) return;
  configurePermissions();
  desktopRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      BrowserHost.layer,
      settingsLayer(app.getPath("userData"), safeStorage).pipe(
        Layer.provide(Layer.mergeAll(NodePath.layer, settingsFileSystemLayer())),
      ),
      LocalOpenCode.layer({
        userDataPath: app.getPath("userData"),
        workerPath: resolveDesktopRuntimeEnvironment().workerPath,
        inspectorPort: profilingPorts.openCodeInspectorPort,
      }),
    ),
  );
  removeLocalOpenCodeUnavailableListener = await desktopRuntime.runPromise(
    Effect.map(LocalOpenCode, (service) => service.onUnavailable(forwardLocalOpenCodeUnavailable)),
  );
  if (quitHandler.isQuitting()) return;
  installIpcHandlers();
  await createMainWindow();

  app.on("activate", () => {
    if (!quitHandler.isQuitting() && BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", quitHandler.beforeQuit);

void start().catch(() => {
  app.quit();
});
