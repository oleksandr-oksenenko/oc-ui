import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  parseLocalOpenCodeConnectResult,
  parseTargetLoadResult,
  parseTargetSaveResult,
  parseVoidResult,
} from "../shared/desktop-api.ts";
import type { DesktopApi } from "../shared/desktop-api.ts";

const desktopApi: DesktopApi = {
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
    disconnect: () =>
      ipcRenderer.invoke(IPC_CHANNELS.localOpenCodeDisconnect).then(parseVoidResult),
    onUnavailable: (listener) => {
      const handler = (): void => listener();
      ipcRenderer.on(IPC_CHANNELS.localOpenCodeUnavailable, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.localOpenCodeUnavailable, handler);
    },
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
