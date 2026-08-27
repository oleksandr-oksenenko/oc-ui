import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import { Effect, ManagedRuntime } from "effect";

import type { SaveConnectionInput } from "../shared/desktop-api.ts";
import { IPC_CHANNELS, parseSaveConnectionInput } from "../shared/desktop-api.ts";
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
let removeIpcHandlers: (() => void) | undefined;
let rendererProtocolInstalled = false;

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

const installIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.connectionLoad, (_event, ...args: unknown[]) => {
    if (args.length !== 0) {
      return Promise.reject(new TypeError("connection.load does not accept arguments"));
    }
    return runSettings(withSettings((service) => service.load));
  });

  ipcMain.handle(IPC_CHANNELS.connectionSave, (_event, rawInput) => {
    let input: SaveConnectionInput;
    try {
      input = parseSaveConnectionInput(rawInput);
    } catch {
      return Promise.reject(new TypeError("invalid connection settings"));
    }

    // Validate at the process boundary before any persistence effect runs.
    const validated: SaveConnectionInput = {
      serverUrl: normalizeServerUrl(input.serverUrl),
      password: validatePassword(input.password),
    };
    return runSettings(withSettings((service) => service.save(validated)));
  });

  ipcMain.handle(IPC_CHANNELS.connectionClear, (_event, ...args: unknown[]) => {
    if (args.length !== 0) {
      return Promise.reject(new TypeError("connection.clear does not accept arguments"));
    }
    return runSettings(withSettings((service) => service.clear));
  });

  removeIpcHandlers = () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
    removeIpcHandlers = undefined;
  };
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

app.on("before-quit", () => {
  removeIpcHandlers?.();
  const runtime = desktopRuntime;
  desktopRuntime = undefined;
  if (runtime !== undefined) {
    void runtime.dispose();
  }
});

void start().catch(() => {
  app.quit();
});
