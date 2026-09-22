import { contextBridge, ipcRenderer } from "electron";
import { Schema } from "effect";
import { BROWSER_CHANNELS, BrowserEvent, type BrowserRequest } from "../shared/browser-api.ts";

import {
  IPC_CHANNELS,
  parseLocalOpenCodeConnectResult,
  parseOpenExternalUrl,
  parseTargetLoadResult,
  parseTargetSaveResult,
  parseVoidResult,
} from "../shared/desktop-api.ts";
import type { DesktopApi } from "../shared/desktop-api.ts";

const invokeBrowser = (input: typeof BrowserRequest.Type) =>
  ipcRenderer.invoke(BROWSER_CHANNELS.request, input).then(parseVoidResult);

const openExternal = async (url: string) =>
  parseVoidResult(
    await ipcRenderer.invoke(IPC_CHANNELS.openExternal, parseOpenExternalUrl(url).href),
  );

const desktopApi: DesktopApi = {
  browser: {
    attach: (input) => invokeBrowser({ ...input, _tag: "attach" }),
    detach: (input) => invokeBrowser({ ...input, _tag: "detach" }),
    command: (input) => invokeBrowser({ ...input, _tag: "command" }),
    layout: (input) => invokeBrowser({ ...input, _tag: "layout" }),
    annotationStart: (input) => invokeBrowser({ ...input, _tag: "annotationStart" }),
    annotationCancel: (input) => invokeBrowser({ ...input, _tag: "annotationCancel" }),
    forget: (input) => invokeBrowser({ ...input, _tag: "forget" }),
    onEvent: (listener) => {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC payload is decoded at this boundary.
      const receive = (_event: Electron.IpcRendererEvent, value: unknown) =>
        listener(Schema.decodeUnknownSync(BrowserEvent)(value));
      ipcRenderer.on(BROWSER_CHANNELS.event, receive);
      return () => ipcRenderer.removeListener(BROWSER_CHANNELS.event, receive);
    },
  },
  target: {
    load: () => ipcRenderer.invoke(IPC_CHANNELS.targetLoad).then(parseTargetLoadResult),
    saveLocal: () =>
      ipcRenderer
        .invoke(IPC_CHANNELS.targetSave, { kind: "local" })
        .then(parseTargetSaveResult)
        .then(() => undefined),
    saveRemote: (input) =>
      ipcRenderer
        .invoke(IPC_CHANNELS.targetSave, { kind: "remote", ...input })
        .then(parseTargetSaveResult),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.targetClear).then(parseVoidResult),
  },
  localOpenCode: {
    connect: () =>
      ipcRenderer.invoke(IPC_CHANNELS.localOpenCodeConnect).then(parseLocalOpenCodeConnectResult),
    onUnavailable: (listener) => {
      const handler = (): void => listener();
      ipcRenderer.on(IPC_CHANNELS.localOpenCodeUnavailable, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.localOpenCodeUnavailable, handler);
    },
  },
  openExternal,
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
