import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from "electron";
import { Effect, ManagedRuntime, Schema } from "effect";

import type { SaveTargetInput } from "../shared/desktop-api.ts";
import { IPC_CHANNELS, parseSaveTargetInput } from "../shared/desktop-api.ts";
import {
  createLocalOpenCodeService,
  LocalOpenCodeUnavailableError,
  type LocalOpenCodeService,
} from "./local-opencode.ts";
import type { SettingsService } from "./settings.ts";
import type { SettingsError } from "./settings.ts";
import { normalizeServerUrl, settingsLayer, Settings, validatePassword } from "./settings.ts";

const RENDERER_SCHEME = "oc";
const RENDERER_HOST = "renderer";
const APP_NAME = "Ocui";

// Raw development launches otherwise inherit Electron's shared profile. Give
// this app the same isolated identity and Chromium state it will have packaged.
app.setName(APP_NAME);
const appUserData = join(app.getPath("appData"), APP_NAME);
const appSessionData = join(appUserData, "Session Data");
mkdirSync(appSessionData, { recursive: true });
app.setPath("userData", appUserData);
app.setPath("sessionData", appSessionData);

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

type DesktopRuntime = ManagedRuntime.ManagedRuntime<SettingsService, never>;

let mainWindow: BrowserWindow | undefined;
let desktopRuntime: DesktopRuntime | undefined;
let localOpenCode: LocalOpenCodeService | undefined;
let removeIpcHandlers: (() => void) | undefined;
let removeLocalOpenCodeUnavailableListener: (() => void) | undefined;
let rendererProtocolInstalled = false;
let quitting = false;
let quitCleanupComplete = false;
let localOpenCodeWasConnected = false;
let settingsMutation: Promise<void> = Promise.resolve();

const withSettings = <A>(
  operation: (service: SettingsService) => Effect.Effect<A, SettingsError>,
): Effect.Effect<A, SettingsError, SettingsService> =>
  Effect.gen(function* () {
    const service = yield* Settings;
    return yield* operation(service);
  });

const runSettings = <A>(program: Effect.Effect<A, SettingsError, SettingsService>): Promise<A> => {
  if (desktopRuntime === undefined) {
    return Promise.reject(new Error("Desktop services are not ready"));
  }
  return desktopRuntime.runPromise(program);
};

const runLocalOpenCode = <A>(
  operation: (service: LocalOpenCodeService) => Promise<A>,
): Promise<A> => {
  if (quitting || localOpenCode === undefined) {
    return Promise.reject(new Error("Desktop services are not ready"));
  }
  return operation(localOpenCode);
};

const queueSettingsMutation = <A>(operation: () => Promise<A>): Promise<A> => {
  const result = settingsMutation.then(operation);
  settingsMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const assertTrustedIpcSender = (event: IpcMainInvokeEvent): void => {
  if (quitting) throw new Error("Desktop services are not ready");
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
    return settingsMutation.then(() => runSettings(withSettings((service) => service.load)));
  });

  ipcMain.handle(IPC_CHANNELS.targetSave, (event, rawInput) => {
    assertTrustedIpcSender(event);
    let input: SaveTargetInput;
    try {
      input = parseSaveTargetInput(rawInput);
    } catch {
      return Promise.reject(new TypeError("invalid OpenCode target"));
    }

    const validated: SaveTargetInput =
      input.kind === "local"
        ? input
        : input.password === undefined
          ? { kind: "remote", serverUrl: normalizeServerUrl(input.serverUrl) }
          : {
              kind: "remote",
              serverUrl: normalizeServerUrl(input.serverUrl),
              password: validatePassword(input.password),
            };
    return queueSettingsMutation(() =>
      runSettings(withSettings((service) => service.save(validated))),
    );
  });

  ipcMain.handle(IPC_CHANNELS.targetClear, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("target.clear does not accept arguments"));
    }
    return queueSettingsMutation(() => runSettings(withSettings((service) => service.clear)));
  });

  ipcMain.handle(IPC_CHANNELS.localOpenCodeConnect, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("localOpenCode.connect does not accept arguments"));
    }
    return runLocalOpenCode(async (service) => {
      try {
        const connection = await service.connect();
        localOpenCodeWasConnected = true;
        return { status: "connected" as const, connection };
      } catch (cause) {
        const error = Schema.is(LocalOpenCodeUnavailableError)(cause)
          ? cause
          : LocalOpenCodeUnavailableError.fromReason("start-failed");
        return { status: "failed" as const, message: error.message };
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.localOpenCodeDisconnect, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    if (args.length !== 0) {
      return Promise.reject(new TypeError("localOpenCode.disconnect does not accept arguments"));
    }
    localOpenCodeWasConnected = false;
    return runLocalOpenCode((service) => service.disconnect());
  });

  removeIpcHandlers = () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
    removeIpcHandlers = undefined;
  };
};

const forwardLocalOpenCodeUnavailable = (): void => {
  if (!localOpenCodeWasConnected || mainWindow === undefined || mainWindow.isDestroyed()) return;
  localOpenCodeWasConnected = false;
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
    if (candidateRelative.startsWith("..") || candidateRelative.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    // Resolve symlinks too, so an asset cannot escape the packaged renderer directory.
    const canonicalCandidate = await realpath(candidate).catch(() => undefined);
    if (canonicalCandidate === undefined) {
      return new Response("Not found", { status: 404 });
    }
    const canonicalRelative = relative(root, canonicalCandidate);
    if (canonicalRelative.startsWith("..") || canonicalRelative.includes("..")) {
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
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const developmentOrigin =
    developmentUrl === undefined ? undefined : new URL(developmentUrl).origin;

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1_280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
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

  const rendererRoot = join(__dirname, "../renderer");
  if (!rendererProtocolInstalled) {
    await installRendererProtocol(rendererRoot);
    rendererProtocolInstalled = true;
  }
  await mainWindow.loadURL(`${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`);
};

const start = async (): Promise<void> => {
  await app.whenReady();
  configurePermissions();
  desktopRuntime = ManagedRuntime.make(settingsLayer(app.getPath("userData"), safeStorage));
  localOpenCode = createLocalOpenCodeService({ userDataPath: app.getPath("userData") });
  removeLocalOpenCodeUnavailableListener = localOpenCode.onUnavailable(
    forwardLocalOpenCodeUnavailable,
  );
  installIpcHandlers();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitCleanupComplete) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  const sidecar = localOpenCode;
  void (async () => {
    try {
      await sidecar?.disconnect();
    } catch {
      quitting = false;
      return;
    }
    await settingsMutation;
    removeIpcHandlers?.();
    removeLocalOpenCodeUnavailableListener?.();
    removeLocalOpenCodeUnavailableListener = undefined;
    localOpenCode = undefined;
    const runtime = desktopRuntime;
    desktopRuntime = undefined;
    await runtime?.dispose();
    quitCleanupComplete = true;
    app.quit();
  })();
});

void start().catch(() => {
  app.quit();
});
