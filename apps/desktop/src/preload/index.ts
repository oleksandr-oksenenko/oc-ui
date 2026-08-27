import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  parseConnectionClearResult,
  parseConnectionLoadResult,
  parseConnectionSaveResult,
} from "../shared/desktop-api.ts";
import type { DesktopApi } from "../shared/desktop-api.ts";

const desktopApi: DesktopApi = {
  connection: {
    load: () => ipcRenderer.invoke(IPC_CHANNELS.connectionLoad).then(parseConnectionLoadResult),
    save: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionSave, input).then(parseConnectionSaveResult),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.connectionClear).then(parseConnectionClearResult),
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
